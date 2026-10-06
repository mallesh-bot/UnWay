import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BatteryLow, Search, WifiOff } from "lucide-react";
import { useAuth, useSettings } from "../lib/auth";
import { rpc, supabase } from "../lib/supabase";
import type { CustodyState, ExceptionRow, LiveBoard as LB, LiveBus, LiveTrip } from "../lib/types";
import { ago, directionLabel, EXCEPTION_LABEL, fmtTime, minutesSince } from "../lib/format";
import { useStudentsLite } from "../lib/queries";
import { Badge, Button, CustodyBar, Empty, ErrorBox, Kpi, Loading, Panel, Plate, StateBadge, cx } from "../components/ui";
import MapView, { type MapMarker } from "../components/MapView";

function activeTrip(b: LiveBus): LiveTrip | undefined {
  return b.trips.find((t) => t.status === "active") ?? b.trips.find((t) => t.status === "scheduled") ?? b.trips[b.trips.length - 1];
}

export default function LiveBoard() {
  const { org, campus } = useAuth();
  const settings = useSettings();
  const [selected, setSelected] = useState<string | null>(null);

  const board = useQuery({ queryKey: ["live-board"], queryFn: () => rpc<LB>("live_board"), refetchInterval: 10_000 });
  const exceptions = useQuery({
    queryKey: ["live-exceptions"], refetchInterval: 15_000,
    queryFn: async () => (await supabase.from("exceptions").select("*").neq("status", "resolved").order("opened_at", { ascending: false }).limit(8)).data as ExceptionRow[],
  });

  // realtime: bus positions
  useEffect(() => {
    if (!org) return;
    const ch = supabase.channel("live-" + org.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "bus_live_state", filter: `org_id=eq.${org.id}` }, () => board.refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_manifest", filter: `org_id=eq.${org.id}` }, () => board.refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);

  const buses = board.data?.buses ?? [];
  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (campus?.lat && campus.lng) m.push({ id: "school", kind: "school", lat: campus.lat, lng: campus.lng, label: campus.name });
    for (const b of buses) {
      if (!b.live?.lat || !b.live.lng) continue;
      const t = activeTrip(b);
      const stale = minutesSince(b.live.updated_at) > settings.device_offline_min;
      if (t?.status !== "active" && minutesSince(b.live.updated_at) > 60) continue;
      m.push({
        id: b.bus_id, kind: "bus", lat: b.live.lat, lng: b.live.lng, label: b.display_number,
        tone: stale ? "offline" : t && t.missing > 0 ? "late" : "ok",
        popup: `<b>Bus ${b.display_number}</b><br/>${t ? `${t.route_code} · ${t.on_board} on bus` : "No trip"}<br/>Updated ${ago(b.live.updated_at)}`,
      });
    }
    return m;
  }, [buses, campus, settings.device_offline_min]);

  const k = board.data?.kpi;
  const sel = buses.find((b) => b.bus_id === selected);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Live map</h1>
          <p className="text-ink-3">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} · updated {board.dataUpdatedAt ? ago(new Date(board.dataUpdatedAt).toISOString()) : "…"}</p>
        </div>
        <WhereIsChild />
      </div>

      <ErrorBox error={board.error} />

      {k && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 neu rounded-[20px] px-6 py-5 sm:grid-cols-4 xl:grid-cols-7">
          <Kpi label="Trips running" value={k.active_trips} />
          <Kpi label="Not started yet" value={k.scheduled_trips} />
          <Kpi label="Late to start" value={k.late_trips} tone={k.late_trips ? "warn" : undefined} />
          <Kpi label="Children on buses" value={k.on_board} />
          <Kpi label="Missed / unconfirmed" value={k.not_boarded} tone={k.not_boarded ? "alert" : undefined} />
          <Kpi label="Open exceptions" value={k.open_exceptions} tone={k.open_exceptions ? "alert" : undefined} />
          <Kpi label="Buses offline" value={k.offline_buses} tone={k.offline_buses ? "warn" : undefined} />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
        <div className="space-y-5">
          <div className="overflow-hidden neu rounded-[20px]">
            <MapView className="h-[460px] w-full" markers={markers} fitKey={String(markers.length)}
              center={campus?.lat ? [campus.lat, campus.lng!] : undefined} onMarkerClick={(id) => id !== "school" && setSelected(id)} />
          </div>
          <Panel title="Needs attention" actions={<Link to="/exceptions" className="text-sm font-semibold text-route">All exceptions</Link>} padded={false}>
            {exceptions.data?.length ? (
              <ul className="divide-y divide-line">
                {exceptions.data.map((x) => (
                  <li key={x.id} className="flex items-start gap-3 px-4 py-3">
                    <span className={cx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", x.severity === "critical" || x.severity === "high" ? "bg-alert" : "bg-warn")} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{EXCEPTION_LABEL[x.code] ?? x.code}</div>
                      <div className="text-sm text-ink-2">{x.message}</div>
                    </div>
                    <span className="text-sm text-ink-3 whitespace-nowrap">{fmtTime(x.opened_at)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-6 text-ink-3">Nothing needs attention right now.</p>}
          </Panel>
        </div>

        <div className="space-y-3">
          {board.isLoading && <Loading />}
          {!board.isLoading && buses.length === 0 && (
            <Panel><Empty title="No buses yet" action={<div className="flex flex-wrap justify-center gap-2"><Link to="/buses"><Button variant="primary">Add a bus</Button></Link><DemoButton onDone={() => board.refetch()} /></div>}>Add buses, routes and students to see them here, or load demo data to try everything first.</Empty></Panel>
          )}
          {buses.map((b) => <BusRow key={b.bus_id} bus={b} selected={selected === b.bus_id} offlineMin={settings.device_offline_min} onSelect={() => setSelected(selected === b.bus_id ? null : b.bus_id)} />)}
        </div>
      </div>

      {sel && <BusDetail bus={sel} onClose={() => setSelected(null)} />}
    </div>
  );
}

function DemoButton({ onDone }: { onDone: () => void }) {
  const { canWrite } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!canWrite) return null;
  return (
    <Button disabled={busy} onClick={async () => {
      setBusy(true);
      try { await rpc("create_demo_data"); toast.success("Demo data added. Crew PIN is 1234."); qc.invalidateQueries(); onDone(); }
      catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
    }}>{busy ? "Adding…" : "Load demo data"}</Button>
  );
}

function BusRow({ bus, selected, onSelect, offlineMin }: { bus: LiveBus; selected: boolean; onSelect: () => void; offlineMin: number }) {
  const t = activeTrip(bus);
  const offline = t?.status === "active" && minutesSince(bus.live?.updated_at) > offlineMin;
  const battery = bus.live?.battery ?? bus.device?.battery;
  return (
    <button onClick={onSelect} className={cx("neu w-full rounded-[22px] border p-5 text-left transition-all duration-300",
      selected ? "border-transparent shadow-[inset_4px_4px_9px_var(--neu-dark),inset_-4px_-4px_9px_var(--neu-light)]" : "border-transparent hover:-translate-y-0.5")}>
      <div className="flex items-center gap-3">
        <Plate>{bus.display_number}</Plate>
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{t ? `${t.route_code} · ${directionLabel(t.direction)}` : "No trip today"}</div>
          <div className="truncate text-sm text-ink-3">
            {t?.status === "active" ? `Started ${fmtTime(t.started_at)} · ${t.stops_done}/${t.stops_total} stops`
              : t?.status === "scheduled" ? `Starts ${fmtTime(t.scheduled_start)}`
              : t ? `Finished ${fmtTime(t.completed_at)}` : bus.registration_no}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {t?.status === "active" && !offline && <Badge tone="route">Running</Badge>}
          {offline && <Badge tone="warn"><WifiOff size={12} /> Offline</Badge>}
          {t?.status === "scheduled" && minutesSince(t.scheduled_start) > 10 && <Badge tone="warn">Late</Badge>}
          {battery != null && battery < 20 && <Badge tone="alert"><BatteryLow size={12} /> {battery}%</Badge>}
        </div>
      </div>
      {t && (t.status === "active" || t.expected > 0) && (
        <div className="mt-3">
          <CustodyBar expected={t.expected} onBoard={t.on_board} dropped={t.dropped} missing={t.missing} />
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular whitespace-nowrap">
            <span><b>{t.on_board}</b> on bus</span>
            <span className="text-safe"><b>{t.dropped}</b> dropped</span>
            {t.waiting > 0 && t.status === "active" && <span className="text-ink-3"><b>{t.waiting}</b> waiting</span>}
            {t.missing > 0 && <span className="text-alert"><b>{t.missing}</b> missing</span>}
            <span className="ml-auto text-ink-3">{t.expected} expected</span>
          </div>
        </div>
      )}
    </button>
  );
}

function BusDetail({ bus, onClose }: { bus: LiveBus; onClose: () => void }) {
  const t = activeTrip(bus);
  const manifest = useQuery({
    queryKey: ["bus-manifest", t?.id], enabled: !!t, refetchInterval: 10_000,
    queryFn: async () => (await supabase.from("trip_manifest").select("state,state_at,board_at,drop_at,student_id,students(first_name,last_name,class_name,section),stops(name)").eq("trip_id", t!.id)).data as unknown as
      { state: CustodyState; state_at: string; board_at: string | null; drop_at: string | null; student_id: string; students: { first_name: string; last_name: string; class_name: string | null; section: string | null }; stops: { name: string } | null }[],
  });
  const groups: [string, CustodyState[]][] = [["Missing / needs check", ["MISSED", "UNCONFIRMED"]], ["Waiting", ["EXPECTED"]], ["On the bus", ["ON_BOARD"]], ["Dropped", ["DROPPED", "HANDED_OVER"]], ["Not travelling", ["ABSENT_NOTIFIED", "NO_SHOW", "TRANSFERRED"]]];
  return (
    <Panel title={<span className="flex items-center gap-3"><Plate>{bus.display_number}</Plate> {t ? `${t.route_name}` : "No trip"}</span>}
      actions={<>{t && <Link to={`/trips/${t.id}`}><Button size="sm">Open trip</Button></Link>}<Button size="sm" variant="ghost" onClick={onClose}>Close</Button></>}>
      <div className="mb-4 grid gap-2 text-sm sm:grid-cols-4">
        <div><span className="text-ink-3">Driver</span><div className="font-semibold">{t?.driver ?? "–"}</div></div>
        <div><span className="text-ink-3">Attendant</span><div className="font-semibold">{t?.attendant ?? "–"}</div></div>
        <div><span className="text-ink-3">Last location</span><div className="font-semibold">{ago(bus.live?.updated_at)}{bus.live?.speed_kmh != null ? ` · ${Math.round(bus.live.speed_kmh)} km/h` : ""}</div></div>
        <div><span className="text-ink-3">Phone</span><div className="font-semibold">{bus.device ? `${bus.device.battery ?? "?"}% · v${bus.device.app_version ?? "?"}` : "Not paired"}</div></div>
      </div>
      {!t ? <p className="text-ink-3">No trip for this bus today.</p> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map(([label, states]) => {
            const rows = (manifest.data ?? []).filter((r) => states.includes(r.state));
            if (!rows.length) return null;
            return (
              <div key={label}>
                <h3 className="mb-1.5 text-sm font-bold text-ink-2">{label} <span className="tabular text-ink-3">({rows.length})</span></h3>
                <ul className="space-y-1">
                  {rows.map((r) => (
                    <li key={r.student_id} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-1.5 text-sm">
                      <Link to={`/students/${r.student_id}`} className="min-w-0 truncate font-semibold hover:underline">{r.students.first_name} {r.students.last_name}</Link>
                      <span className="flex items-center gap-2 whitespace-nowrap text-ink-3">{r.stops?.name}<StateBadge state={r.state} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function WhereIsChild() {
  const students = useStudentsLite();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ name: string; data: Record<string, unknown> } | null>(null);
  const matches = q.length >= 2 ? (students.data ?? []).filter((s) => `${s.first_name} ${s.last_name} ${s.admission_no ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];
  async function pick(id: string, name: string) {
    setQ(""); setResult({ name, data: await rpc<Record<string, unknown>>("where_is_student", { p_student_id: id }) });
  }
  return (
    <div className="relative w-full max-w-sm">
      <label className="flex h-10 items-center gap-2 neu-inset rounded-xl px-3.5">
        <Search size={17} className="text-ink-3" aria-hidden />
        <input value={q} onChange={(e) => { setQ(e.target.value); setResult(null); }} placeholder="Where is a child right now?" className="w-full bg-transparent outline-none" />
      </label>
      {matches.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl bg-panel shadow-[var(--shadow-pop)]">
          {matches.map((s) => (
            <li key={s.id}><button className="w-full px-3 py-2 text-left hover:bg-surface" onClick={() => pick(s.id, `${s.first_name} ${s.last_name}`)}>
              <b>{s.first_name} {s.last_name}</b> <span className="text-ink-3">{[s.class_name, s.section].filter(Boolean).join("-")}</span>
            </button></li>
          ))}
        </ul>
      )}
      {result && (
        <div className="absolute z-20 mt-1 w-full rounded-2xl bg-panel p-4 shadow-[var(--shadow-pop)]">
          <div className="flex items-center justify-between"><b>{result.name}</b><button className="text-sm text-ink-3" onClick={() => setResult(null)}>Close</button></div>
          {result.data.state === "NO_TRIP_TODAY" ? <p className="text-ink-3">No bus trip today.</p> : (
            <div className="mt-1 space-y-1 text-sm">
              <div className="flex items-center gap-2"><StateBadge state={result.data.state as CustodyState} /> since {fmtTime(result.data.state_at as string)}</div>
              <div>Bus <b>{String(result.data.bus ?? "–")}</b> · {directionLabel(String(result.data.direction))} trip ({String(result.data.trip_status)})</div>
              <Link className="font-semibold text-route" to={`/trips/${result.data.trip_id}`}>Open trip</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
