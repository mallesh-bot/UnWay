import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Bus as BusIcon, Clock3, Home as HomeIcon, MapPin, Search, Sparkles, TriangleAlert } from "lucide-react";
import { useAuth } from "../lib/auth";
import { check, rpc, supabase } from "../lib/supabase";
import { useBuses } from "../lib/queries";
import { geocode, planPayload, planRoutes, sleep, type Home, type Plan } from "../lib/planner";
import { Badge, Button, Field, Input, Notice, PageHeader, Panel, Plate, Select, Toggle, cx } from "../components/ui";
import { Meter } from "../components/Charts";
import MapView, { type MapMarker } from "../components/MapView";

interface StudentHome { id: string; first_name: string; last_name: string; home_lat: number | null; home_lng: number | null; home_address: string | null; transport_status: string }

export default function AutoPlan() {
  const { campus, canWrite } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const buses = useBuses();
  const students = useQuery({
    queryKey: ["student-homes"],
    queryFn: async () => check(await supabase.from("students").select("id,first_name,last_name,home_lat,home_lng,home_address,transport_status")
      .eq("transport_status", "active").order("first_name").limit(5000)) as StudentHome[],
  });
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [radius, setRadius] = useState(300);
  const [arriveBy, setArriveBy] = useState("08:00");
  const [leaveAt, setLeaveAt] = useState("15:30");
  const [replace, setReplace] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [geo, setGeo] = useState<{ done: number; total: number; found: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const school: [number, number] | null = campus?.lat ? [campus.lat, campus.lng!] : null;
  const all = students.data ?? [];
  const located = all.filter((s) => s.home_lat != null && s.home_lng != null);
  const addressOnly = all.filter((s) => s.home_lat == null && s.home_address);
  const nothing = all.filter((s) => s.home_lat == null && !s.home_address);
  const activeBuses = (buses.data ?? []).filter((b) => b.status === "active");
  const chosen = activeBuses.filter((b) => picked[b.id] ?? true);
  const seats = chosen.reduce((a, b) => a + b.capacity, 0);

  async function findHomes() {
    if (!school) return;
    setGeo({ done: 0, total: addressOnly.length, found: 0 });
    let found = 0;
    const rows: { student_id: string; home_lat: number; home_lng: number }[] = [];
    for (let i = 0; i < addressOnly.length; i++) {
      const s = addressOnly[i];
      try {
        const p = await geocode(s.home_address!, school);
        if (p && Math.abs(p[0] - school[0]) < 1 && Math.abs(p[1] - school[1]) < 1) { rows.push({ student_id: s.id, home_lat: p[0], home_lng: p[1] }); found++; }
      } catch { /* skip */ }
      setGeo({ done: i + 1, total: addressOnly.length, found });
      if (rows.length >= 20 || i === addressOnly.length - 1) { if (rows.length) await rpc("set_student_homes", { p_rows: rows.splice(0) }); }
      await sleep(1100);
    }
    toast.success(`Found ${found} of ${addressOnly.length} homes on the map`);
    qc.invalidateQueries({ queryKey: ["student-homes"] });
  }

  function makePlan() {
    if (!school) return toast.error("Set the school location in Settings first.");
    if (!chosen.length) return toast.error("Pick at least one bus.");
    const homes: Home[] = located.map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}`.trim(), lat: s.home_lat!, lng: s.home_lng!, address: s.home_address }));
    setPlan(planRoutes({ homes, school, buses: chosen, radius, arriveBy, leaveAt }));
  }

  async function apply() {
    if (!plan) return;
    if (replace && !confirm("This switches off your current routes from today and moves students to the new ones. Continue?")) return;
    setBusy(true);
    try {
      const r = await rpc<{ routes: number; students: number }>("apply_route_plan", { p_plan: planPayload(plan), p_replace: replace });
      toast.success(`${r.routes} routes created for ${r.students} students. Trips for today and tomorrow are ready.`);
      qc.invalidateQueries();
      nav("/routes");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (school) m.push({ id: "school", kind: "school", lat: school[0], lng: school[1], label: campus?.name });
    if (plan) plan.routes.forEach((r) => r.stops.forEach((s, i) => m.push({
      id: s.key, kind: "stop", lat: s.lat, lng: s.lng, label: String(i + 1), color: r.color,
      popup: `<b>${s.name}</b><br/>Bus ${r.bus.display_number} · stop ${i + 1}<br/>${s.students.length} students · +${s.offset_min} min`,
    })));
    else located.forEach((s) => m.push({ id: s.id, kind: "point", lat: s.home_lat!, lng: s.home_lng!, popup: `${s.first_name} ${s.last_name}` }));
    return m;
  }, [plan, located, school, campus?.name]);
  const lines = useMemo(() => plan?.routes.map((r) => ({ color: r.color, coords: [...r.stops.map((s) => [s.lat, s.lng] as [number, number]), ...(school ? [school] : [])] })) ?? [], [plan, school]);

  return (
    <div className="space-y-5">
      <Link to="/routes" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-3 hover:text-ink"><ArrowLeft size={15} /> Routes & stops</Link>
      <PageHeader title="Auto-plan routes" eyebrow={<span className="flex items-center gap-1.5 text-bus-deep"><Sparkles size={14} /> Automation</span>}
        sub="UnWay groups nearby homes into stops, splits them between your buses and works out the timings. Check the plan, then apply it in one click." />

      {!school && <Notice tone="warn" icon={TriangleAlert} title="Set your school's location first" action={<Link to="/settings"><Button size="sm">Settings</Button></Link>} />}

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <div className="space-y-5">
          <Panel title={<span className="flex items-center gap-2"><HomeIcon size={17} /> 1. Home locations</span>}>
            <Meter value={located.length} max={all.length} tone={located.length === all.length ? "safe" : "route"} label="Students with a home on the map" />
            {addressOnly.length > 0 && (
              <div className="mt-4 rounded-xl bg-surface p-3">
                <p className="text-sm"><b>{addressOnly.length}</b> students have an address but no map location yet.</p>
                {geo ? (
                  <div className="mt-2"><Meter value={geo.done} max={geo.total} label={`Looking up addresses… ${geo.found} found`} /></div>
                ) : (
                  <Button size="sm" className="mt-2" disabled={!canWrite || !school} onClick={findHomes}><Search size={14} /> Find them on the map</Button>
                )}
                <p className="mt-2 text-xs text-ink-3">Uses OpenStreetMap, about one address per second.</p>
              </div>
            )}
            {nothing.length > 0 && (
              <p className="mt-3 text-sm text-ink-3"><b className="text-ink">{nothing.length}</b> students have no address. Add <code>home_address</code> (or <code>home_lat</code>/<code>home_lng</code>) columns to your <Link className="font-semibold text-route" to="/students/import">import sheet</Link>, or open the student to add it.</p>
            )}
          </Panel>

          <Panel title={<span className="flex items-center gap-2"><BusIcon size={17} /> 2. Buses and times</span>}>
            <div className="space-y-1.5">
              {activeBuses.map((b) => (
                <label key={b.id} className="flex items-center gap-3 rounded-lg px-1 py-1">
                  <input type="checkbox" className="h-4 w-4" checked={picked[b.id] ?? true} onChange={(e) => setPicked({ ...picked, [b.id]: e.target.checked })} />
                  <Plate>{b.display_number}</Plate><span className="text-sm text-ink-3">{b.capacity} seats</span>
                </label>
              ))}
              {!activeBuses.length && <p className="text-sm text-ink-3">Add buses first in <Link to="/buses" className="font-semibold text-route">Buses & crew</Link>.</p>}
            </div>
            <p className={cx("mt-2 text-sm", seats < located.length ? "font-semibold text-alert" : "text-ink-3")}>{seats} seats for {located.length} students</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Reach school by"><Input type="time" value={arriveBy} onChange={(e) => setArriveBy(e.target.value)} /></Field>
              <Field label="Leave school at"><Input type="time" value={leaveAt} onChange={(e) => setLeaveAt(e.target.value)} /></Field>
            </div>
            <Field label="Walk to the stop, at most" className="mt-3">
              <Select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
                <option value={150}>150 m (more stops, door-step)</option><option value={300}>300 m (recommended)</option><option value={500}>500 m (fewer stops, faster)</option>
              </Select>
            </Field>
            <Button variant="bus" className="mt-4 w-full" disabled={!located.length || !chosen.length || !school} onClick={makePlan}><Sparkles size={16} /> {plan ? "Plan again" : "Plan routes"}</Button>
          </Panel>
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden neu rounded-[22px]">
            <MapView className="h-[440px] w-full" markers={markers} lines={lines} fitKey={`${plan?.routes.length ?? 0}-${located.length}-${!!school}`} center={school ?? undefined} />
          </div>
          {plan && (
            <Panel title={<span className="flex items-center gap-2"><MapPin size={17} /> 3. Your new routes</span>}
              actions={canWrite && <>
                <label className="flex items-center gap-2 text-sm font-semibold"><Toggle checked={replace} onChange={setReplace} label="Replace current routes" /> Replace current routes</label>
                <Button variant="primary" disabled={busy || !plan.routes.length} onClick={apply}>{busy ? "Applying…" : "Apply plan"}</Button>
              </>} padded={false}>
              <div className="grid divide-y divide-line-2 lg:grid-cols-2 lg:divide-y-0">
                {plan.routes.map((r) => (
                  <div key={r.bus.id} className="border-line-2 p-5 lg:border-b lg:odd:border-r">
                    <div className="flex items-center gap-3">
                      <span className="h-3 w-3 rounded-full" style={{ background: r.color }} />
                      <Plate>{r.bus.display_number}</Plate>
                      <span className="font-bold">{r.stops.length} stops · {r.students} students</span>
                      {r.over_capacity && <Badge tone="alert">Over seats</Badge>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-3">
                      <span className="flex items-center gap-1"><Clock3 size={14} /> Starts {r.am_start}</span>
                      <span>{r.minutes} min to school</span><span>{r.km} km</span>
                    </div>
                    <ol className="mt-3 space-y-1 text-sm">
                      {r.stops.map((s, i) => (
                        <li key={s.key} className="flex items-center gap-2">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 bg-white text-[10px] font-bold" style={{ borderColor: r.color }}>{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate">{s.name}</span>
                          <span className="tabular text-ink-3">{s.students.length} · +{s.offset_min}m</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
              <p className="border-t border-line-2 px-5 py-3 text-sm text-ink-3">Stop names come from addresses; rename or move stops any time in Routes & stops. Times are estimates and improve automatically from real trips.</p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
