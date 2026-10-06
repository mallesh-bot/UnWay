#!/usr/bin/env node
// UnWay bus simulator: pretends to be a bus phone so you can watch the live
// board, parent alerts and reports without a real bus.
//
// Usage (Node 18+):
//   node scripts/simulate-bus.mjs <SUPABASE_URL> <ANON_KEY> <PAIRING_CODE> [--fast]
//
// Get the pairing code from Dashboard → Buses & crew → Pair phone (type the 8-letter code).
// The simulator starts the next trip of that bus, drives through every stop,
// marks every child boarded / dropped, does the Empty Bus Check and finishes.

const [url, key, code] = process.argv.slice(2);
const FAST = process.argv.includes("--fast");
if (!url || !key || !code) {
  console.log("Usage: node scripts/simulate-bus.mjs <SUPABASE_URL> <ANON_KEY> <PAIRING_CODE> [--fast]");
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? ms / 10 : ms));
let token = null;

async function rpc(fn, args = {}) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(token ? { p_token: token, ...args } : args),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${fn}: ${body?.message ?? res.status}`);
  return body;
}
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function interpolate(a, b, steps) {
  return Array.from({ length: steps }, (_, i) => ({ lat: a.lat + ((b.lat - a.lat) * (i + 1)) / steps, lng: a.lng + ((b.lng - a.lng) * (i + 1)) / steps }));
}

async function drive(tripId, from, to, label) {
  const pts = interpolate(from, to, 6);
  for (const p of pts) {
    await rpc("dev_locations", { p_trip_id: tripId, p_points: [{ ts: now(), lat: p.lat, lng: p.lng, acc: 8, speed: 8, heading: 0 }], p_battery: 87 });
    await sleep(2000);
  }
  console.log(`  🚌 reached ${label}`);
}

(async () => {
  const paired = await rpc("dev_pair", { p_code: code, p_info: { model: "UnWay simulator", app_version: "sim" } });
  token = paired.device_token;
  console.log(`Paired as bus ${paired.bus.display_number} (${paired.org.name})`);
  const boot = await rpc("dev_bootstrap");
  const trip = boot.trips.find((t) => t.status === "scheduled" || t.status === "active");
  if (!trip) { console.log("No trip left today for this bus. Create trips in Dashboard → Trips."); return; }
  const driver = boot.crew.find((c) => c.role === "driver") ?? boot.crew[0];
  const attendant = boot.crew.find((c) => c.role === "attendant") ?? driver;
  if (!driver) { console.log("Add crew first."); return; }
  console.log(`Starting ${trip.direction} trip ${trip.route_code} with ${driver.name}`);
  const data = await rpc("dev_start_trip", { p_trip_id: trip.id, p_driver_id: driver.id, p_attendant_id: attendant.id });
  const school = { lat: data.school.lat, lng: data.school.lng };
  const send = (kind, extra = {}) => rpc("dev_sync", { p_events: [{ id: id(), kind, trip_id: trip.id, ts: now(), crew_id: attendant.id, ...extra }] });

  if (trip.direction === "MORNING") {
    let pos = { lat: data.stops[0].lat - 0.004, lng: data.stops[0].lng - 0.002 };
    for (const stop of data.stops) {
      await drive(trip.id, pos, stop, stop.name);
      const kids = data.manifest.filter((m) => m.stop_id === stop.id && m.state === "EXPECTED");
      for (const k of kids) {
        if (Math.random() < 0.1) { console.log(`  ✗ ${k.name} not at stop`); continue; }
        const r = await send("scan", { lat: stop.lat, lng: stop.lng, data: { student_id: k.student_id, type: "BOARD", reason: "simulator" } });
        console.log(`  ✓ ${k.name} boarded (${r.results[0].result})`);
        await sleep(1500);
      }
      pos = stop;
    }
    await drive(trip.id, pos, school, "school");
    await send("arrive", { lat: school.lat, lng: school.lng, data: { bulk_deboard: true } });
    console.log("  🏫 everyone checked out at school");
  } else {
    await rpc("dev_locations", { p_trip_id: trip.id, p_points: [{ ts: now(), ...school, acc: 8, speed: 0 }] });
    for (const k of data.manifest.filter((m) => m.state === "EXPECTED")) {
      await send("scan", { lat: school.lat, lng: school.lng, data: { student_id: k.student_id, type: "BOARD", reason: "simulator" } });
      console.log(`  ✓ ${k.name} boarded at school`);
      await sleep(800);
    }
    let pos = school;
    for (const stop of data.stops) {
      await drive(trip.id, pos, stop, stop.name);
      for (const k of data.manifest.filter((m) => m.stop_id === stop.id)) {
        const kind = k.handover_required ? "resolve" : "scan";
        const extra = k.handover_required
          ? { data: { items: [{ student_id: k.student_id, resolution: "handed_over", note: "simulator" }] } }
          : { data: { student_id: k.student_id, type: "DEBOARD", reason: "simulator" } };
        await send(kind, { lat: stop.lat, lng: stop.lng, ...extra });
        console.log(`  ✓ ${k.name} dropped`);
        await sleep(1200);
      }
      pos = stop;
    }
  }
  // resolve anyone left, then Empty Bus Check + finish
  const fresh = await rpc("dev_trip_data", { p_trip_id: trip.id });
  const open = fresh.manifest.filter((m) => m.state === "EXPECTED" || m.state === "ON_BOARD");
  if (open.length) await send("resolve", { data: { items: open.map((m) => ({ student_id: m.student_id, resolution: m.state === "ON_BOARD" ? "dropped_unscanned" : "no_show" })) } });
  await send("empty_check", { data: { items: ["last_row", "under_seats", "no_child_or_bag"] } });
  const done = await send("complete");
  console.log("Trip finished:", done.results[0].ok ? "✓" : done.results[0]);
})().catch((e) => { console.error("Simulator error:", e.message); process.exit(1); });
