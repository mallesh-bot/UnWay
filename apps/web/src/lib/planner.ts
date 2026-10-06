// Automatic route planning from students' home locations (runs in the browser).
// 1. group nearby homes into shared stops, 2. split stops between buses by direction from school
// (sweep), respecting seats, 3. order each route farthest-first, 4. estimate times.

export const ROUTE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"];
export const routeColor = (i: number) => ROUTE_COLORS[i] ?? "#66757f";

export interface Home { id: string; name: string; lat: number; lng: number; address?: string | null }
export interface PlanBus { id: string; display_number: string; capacity: number }
export interface PlanStop { key: string; name: string; lat: number; lng: number; students: Home[] }
export interface PlanRoute {
  bus: PlanBus; code: string; name: string; color: string;
  stops: (PlanStop & { offset_min: number })[];
  students: number; km: number; minutes: number; am_start: string; pm_start: string; over_capacity: boolean;
}
export interface Plan { routes: PlanRoute[]; stops: PlanStop[]; unplaced: Home[] }

export function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const ROAD_FACTOR = 1.35;      // roads are longer than straight lines
const SPEED_KMH = 22;          // average city school-bus speed
const DWELL_MIN = 1;           // per stop

function minutesFor(m: number) { return (m * ROAD_FACTOR) / 1000 / SPEED_KMH * 60; }
function toHHMM(totalMin: number) {
  const m = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function parseHHMM(s: string) { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); }

/** Locality from an Indian-style address: skip house/plot/flat parts (they contain digits) and the city. */
function locality(address?: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) parts.pop(); // the city
  const named = parts.filter((x) => !/^(h\.?\s*no|d\.?\s*no|door|plot|flat|house|road\s*no|#|\d)/i.test(x));
  return named.length ? named[named.length - 1].slice(0, 50) : null;
}

function stopName(members: Home[], n: number, used: Map<string, number>): string {
  const counts = new Map<string, number>();
  for (const h of members) { const l = locality(h.address); if (l) counts.set(l, (counts.get(l) ?? 0) + 1); }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!best) return `Stop ${n}`;
  const k = (used.get(best) ?? 0) + 1;
  used.set(best, k);
  return k === 1 ? best : `${best} ${k}`;
}

/** Leader clustering: farthest homes first, everyone within `radius` joins; the stop sits at the centre. */
export function clusterStops(homes: Home[], school: [number, number], radius: number): PlanStop[] {
  const left = [...homes].sort((a, b) => distM(b.lat, b.lng, ...school) - distM(a.lat, a.lng, ...school));
  const used = new Set<string>();
  const names = new Map<string, number>();
  const stops: PlanStop[] = [];
  for (const h of left) {
    if (used.has(h.id)) continue;
    let members = left.filter((x) => !used.has(x.id) && distM(h.lat, h.lng, x.lat, x.lng) <= radius);
    // re-centre once and pick up anyone now within reach
    const c = centroid(members);
    members = left.filter((x) => !used.has(x.id) && distM(c[0], c[1], x.lat, x.lng) <= radius);
    if (!members.length) members = [h];
    members.forEach((x) => used.add(x.id));
    const cc = centroid(members);
    stops.push({ key: `s${stops.length + 1}`, name: stopName(members, stops.length + 1, names), lat: cc[0], lng: cc[1], students: members });
  }
  return stops;
}

function centroid(hs: { lat: number; lng: number }[]): [number, number] {
  return [hs.reduce((a, h) => a + h.lat, 0) / hs.length, hs.reduce((a, h) => a + h.lng, 0) / hs.length];
}

export function planRoutes(opts: {
  homes: Home[]; school: [number, number]; buses: PlanBus[]; radius: number; arriveBy: string; leaveAt: string;
}): Plan {
  const { homes, school, buses, radius } = opts;
  if (!homes.length || !buses.length) return { routes: [], stops: [], unplaced: homes };
  const stops = clusterStops(homes, school, radius);
  const total = homes.length;
  const seats = buses.reduce((a, b) => a + b.capacity, 0);

  // angle of every stop around the school; start the sweep at the widest empty gap
  const ang = (s: PlanStop) => Math.atan2(s.lat - school[0], (s.lng - school[1]) * Math.cos(school[0] * Math.PI / 180));
  const sorted = [...stops].sort((a, b) => ang(a) - ang(b));
  let gapAt = 0, gap = -1;
  for (let i = 0; i < sorted.length; i++) {
    const a = ang(sorted[i]), b = i + 1 < sorted.length ? ang(sorted[i + 1]) : ang(sorted[0]) + 2 * Math.PI;
    if (b - a > gap) { gap = b - a; gapAt = (i + 1) % sorted.length; }
  }
  const sweep = [...sorted.slice(gapAt), ...sorted.slice(0, gapAt)];

  // Split the sweep into one group per bus. First try natural geographic groups (cut at the widest
  // angular gaps); if a group would not fit its bus, fall back to filling buses evenly in sweep order.
  const order = [...buses].sort((a, b) => b.capacity - a.capacity);
  const n = Math.min(order.length, sweep.length);
  const angGap = (i: number) => { let d = ang(sweep[i + 1]) - ang(sweep[i]); if (d < 0) d += 2 * Math.PI; return d; };
  const cuts = sweep.slice(0, -1).map((_, i) => i).sort((a, b) => angGap(b) - angGap(a)).slice(0, n - 1).sort((a, b) => a - b);
  let groups: PlanStop[][] = [];
  let prev = 0;
  for (const c of cuts) { groups.push(sweep.slice(prev, c + 1)); prev = c + 1; }
  groups.push(sweep.slice(prev));
  const sizeOf = (g: PlanStop[]) => g.reduce((a, s) => a + s.students.length, 0);
  groups.sort((a, b) => sizeOf(b) - sizeOf(a));
  const natural = groups.every((g, i) => sizeOf(g) <= order[i].capacity) && Math.max(...groups.map(sizeOf)) <= 2.2 * (total / n);
  if (!natural) {
    groups = order.map(() => []);
    const loadE = order.map(() => 0);
    let bi = 0;
    for (const s of sweep) {
      const target = Math.min(order[bi].capacity, Math.ceil((total / Math.max(seats, 1)) * order[bi].capacity * 1.08));
      if (loadE[bi] > 0 && loadE[bi] + s.students.length > target && bi < order.length - 1) bi++;
      groups[bi].push(s); loadE[bi] += s.students.length;
    }
  }
  const load = groups.map(sizeOf);

  const arrive = parseHHMM(opts.arriveBy), leave = parseHHMM(opts.leaveAt);
  const routes: PlanRoute[] = [];
  groups.forEach((g, i) => {
    if (!g.length) return;
    // farthest stop first, then nearest neighbour; the last stop is closest to school
    const rest = [...g];
    rest.sort((a, b) => distM(b.lat, b.lng, ...school) - distM(a.lat, a.lng, ...school));
    const seq: PlanStop[] = [rest.shift()!];
    while (rest.length) {
      const last = seq[seq.length - 1];
      let best = 0, bd = Infinity;
      rest.forEach((s, j) => {
        // prefer stops that also move us towards school
        const d = distM(last.lat, last.lng, s.lat, s.lng) + 0.3 * distM(s.lat, s.lng, ...school);
        if (d < bd) { bd = d; best = j; }
      });
      seq.push(rest.splice(best, 1)[0]);
    }
    let t = 0, meters = 0;
    const timed = seq.map((s, j) => {
      if (j > 0) { const d = distM(seq[j - 1].lat, seq[j - 1].lng, s.lat, s.lng); meters += d; t += minutesFor(d) + DWELL_MIN; }
      return { ...s, offset_min: Math.round(t) };
    });
    const toSchool = distM(seq[seq.length - 1].lat, seq[seq.length - 1].lng, ...school);
    meters += toSchool;
    const minutes = Math.round(t + minutesFor(toSchool) + DWELL_MIN);
    const start = Math.floor((arrive - minutes - 5) / 5) * 5;   // 5 min buffer, rounded down
    const bus = order[i];
    routes.push({
      bus, code: `R${bus.display_number}`.replace(/[^A-Za-z0-9-]/g, "").slice(0, 12), name: `Bus ${bus.display_number} route`, color: routeColor(routes.length),
      stops: timed, students: load[i], km: Math.round(meters * ROAD_FACTOR / 100) / 10, minutes,
      am_start: toHHMM(start), pm_start: toHHMM(leave), over_capacity: load[i] > bus.capacity,
    });
  });
  return { routes, stops, unplaced: [] };
}

/** Payload for the apply_route_plan RPC. */
export function planPayload(plan: Plan) {
  return {
    stops: plan.routes.flatMap((r) => r.stops.map((s) => ({ key: s.key, name: s.name, lat: s.lat, lng: s.lng, radius_m: 80 }))),
    routes: plan.routes.map((r) => ({
      bus_id: r.bus.id, code: r.code, name: r.name, am_start: r.am_start, pm_start: r.pm_start,
      stops: r.stops.map((s) => ({ key: s.key, offset_min: s.offset_min })),
      students: r.stops.flatMap((s) => s.students.map((h) => ({ student_id: h.id, stop_key: s.key }))),
    })),
  };
}

/** Free geocoding with OpenStreetMap Nominatim (max 1 request per second, as their policy asks). */
export async function geocode(address: string, near?: [number, number]): Promise<[number, number] | null> {
  const p = new URLSearchParams({ format: "jsonv2", q: address, limit: "1", countrycodes: "in" });
  if (near) {
    const d = 0.35; // ~35 km box around the school, preferred not required
    p.set("viewbox", `${near[1] - d},${near[0] + d},${near[1] + d},${near[0] - d}`);
  }
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${p}`, { headers: { Accept: "application/json" } });
  if (!r.ok) return null;
  const j = (await r.json()) as { lat: string; lon: string }[];
  return j[0] ? [Number(j[0].lat), Number(j[0].lon)] : null;
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
