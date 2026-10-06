import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Megaphone } from "lucide-react";
import { useAuth } from "../lib/auth";
import { check, rpc, supabase } from "../lib/supabase";
import type { CustodyState, ExceptionRow, Incident, ManifestRow, ScanEvent, Trip } from "../lib/types";
import { directionLabel, EXCEPTION_LABEL, fmtDate, fmtTime } from "../lib/format";
import { byId, useBuses, useCrew, useRoutes, useStops } from "../lib/queries";
import { Avatar, Badge, Button, CustodyBar, ErrorBox, Field, Input, Loading, Modal, Panel, Plate, Select, StateBadge, Table, Td, Textarea } from "../components/ui";
import MapView, { type MapMarker } from "../components/MapView";
import { TRIP_STATUS } from "./Trips";

type MRow = ManifestRow & { students: { first_name: string; last_name: string; class_name: string | null; section: string | null; photo_thumb: string | null } };

export default function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const { canWrite, campus } = useAuth();
  const qc = useQueryClient();
  const routes = useRoutes(), buses = useBuses(), stops = useStops(), crew = useCrew();
  const stopMap = byId(stops.data), busMap = byId(buses.data), crewMap = byId(crew.data);

  const data = useQuery({
    queryKey: ["trip", id], refetchInterval: 10_000,
    queryFn: async () => {
      const [t, m, e, x, inc, v, rs, lp] = await Promise.all([
        supabase.from("trips").select("*").eq("id", id!).single(),
        supabase.from("trip_manifest").select("*, students(first_name,last_name,class_name,section,photo_thumb)").eq("trip_id", id!),
        supabase.from("scan_events").select("*").eq("trip_id", id!).order("server_ts"),
        supabase.from("exceptions").select("*").eq("trip_id", id!).order("opened_at", { ascending: false }),
        supabase.from("incidents").select("*").eq("trip_id", id!).order("created_at", { ascending: false }),
        supabase.from("trip_stop_visits").select("*").eq("trip_id", id!),
        supabase.from("route_stops").select("*"),
        supabase.from("location_points").select("lat,lng,ts").eq("trip_id", id!).order("ts").limit(5000),
      ]);
      const trip = check(t) as Trip;
      return {
        trip, manifest: check(m) as MRow[], scans: check(e) as ScanEvent[], exceptions: check(x) as ExceptionRow[],
        incidents: check(inc) as Incident[], visits: check(v) as { stop_id: string; entered_at: string; exited_at: string | null }[],
        routeStops: (check(rs) as { route_id: string; stop_id: string; seq: number; planned_offset_min: number }[]).filter((r) => r.route_id === trip.route_id).sort((a, b) => a.seq - b.seq),
        track: (check(lp) as { lat: number; lng: number }[]).map((p) => [p.lat, p.lng] as [number, number]),
      };
    },
  });
  const [action, setAction] = useState<{ kind: "mark" | "force" | "broadcast" | "transfer"; row?: MRow } | null>(null);

  const markers: MapMarker[] = useMemo(() => {
    if (!data.data) return [];
    const m: MapMarker[] = [];
    if (campus?.lat && campus.lng) m.push({ id: "school", kind: "school", lat: campus.lat, lng: campus.lng });
    data.data.routeStops.forEach((r) => { const s = stopMap[r.stop_id]; if (s) m.push({ id: s.id, kind: "stop", lat: s.lat, lng: s.lng, label: String(r.seq), popup: s.name }); });
    const last = data.data.track.at(-1);
    if (last && data.data.trip.status === "active") m.push({ id: "bus", kind: "bus", lat: last[0], lng: last[1], label: busMap[data.data.trip.bus_id ?? ""]?.display_number ?? "Bus" });
    data.data.incidents.filter((i) => i.lat && i.type.startsWith("sos")).forEach((i) => m.push({ id: i.id, kind: "alert", lat: i.lat!, lng: i.lng!, popup: `SOS: ${i.type.replace("sos_", "")}` }));
    return m;
  }, [data.data, stopMap, campus, busMap]);

  if (data.isLoading) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  const { trip, manifest, scans, exceptions, incidents, visits, routeStops, track } = data.data!;
  const route = routes.data?.find((r) => r.id === trip.route_id);
  const counted = manifest.filter((r) => !["ABSENT_NOTIFIED", "TRANSFERRED"].includes(r.state));
  const refresh = () => qc.invalidateQueries({ queryKey: ["trip", id] });
  const studentMap = Object.fromEntries(manifest.map((m) => [m.student_id, m.students]));

  return (
    <div className="space-y-5">
      <Link to="/trips" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-3 hover:text-ink"><ArrowLeft size={15} /> Trips</Link>
      <div className="flex flex-wrap items-center gap-4">
        <Plate large>{busMap[trip.bus_id ?? ""]?.display_number ?? "?"}</Plate>
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold">{route?.code} · {directionLabel(trip.direction)} <Badge tone={TRIP_STATUS[trip.status].tone} className="align-middle">{TRIP_STATUS[trip.status].label}</Badge></h1>
          <p className="text-ink-3">{fmtDate(trip.trip_date)} · scheduled {fmtTime(trip.scheduled_start)} · started {fmtTime(trip.started_at)}{trip.completed_at ? ` · finished ${fmtTime(trip.completed_at)}` : ""}</p>
          <p className="text-sm text-ink-3">Driver {crewMap[trip.driver_id ?? ""]?.name ?? "–"} · Attendant {crewMap[trip.attendant_id ?? ""]?.name ?? "–"}</p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAction({ kind: "broadcast" })}><Megaphone size={16} /> Message parents</Button>
            {(trip.status === "active" || trip.status === "scheduled") && <Button onClick={() => setAction({ kind: "transfer" })}>Move children to another bus</Button>}
            {trip.status === "active" && <Button variant="danger" onClick={() => setAction({ kind: "force" })}>Close trip</Button>}
            {trip.status === "scheduled" && <Button variant="ghost" onClick={async () => { const r = prompt("Reason for cancelling this trip?"); if (r) { try { await rpc("cancel_trip", { p_trip_id: trip.id, p_reason: r }); refresh(); } catch (e) { toast.error((e as Error).message); } } }}>Cancel trip</Button>}
          </div>
        )}
      </div>

      <div className="neu rounded-[20px] p-4">
        <CustodyBar expected={counted.length} onBoard={counted.filter((r) => r.state === "ON_BOARD").length}
          dropped={counted.filter((r) => ["DROPPED", "HANDED_OVER"].includes(r.state)).length} missing={counted.filter((r) => ["MISSED", "UNCONFIRMED"].includes(r.state)).length} />
        <div className="mt-2 flex flex-wrap gap-x-6 text-sm">
          <span>Empty Bus Check: {trip.empty_bus_check ? <b className="text-safe">done at {fmtTime(String(trip.empty_bus_check.at))}</b> : <b className={trip.status === "active" ? "text-ink-3" : "text-alert"}>not done</b>}</span>
          {trip.completion_reason && <span>Note: {trip.completion_reason}</span>}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <Panel title={`Children (${counted.length})`} padded={false}>
            <Table head={["Student", "Stop", "Status", "Boarded", "Got off", ""]}>
              {manifest.sort((a, b) => a.students.first_name.localeCompare(b.students.first_name)).map((r) => (
                <tr key={r.student_id}>
                  <Td><Link to={`/students/${r.student_id}`} className="flex items-center gap-2"><Avatar src={r.students.photo_thumb} name={`${r.students.first_name} ${r.students.last_name}`} size={28} />
                    <span className="font-semibold">{r.students.first_name} {r.students.last_name}</span>{r.is_guest && <Badge tone="warn">Guest</Badge>}</Link></Td>
                  <Td>{stopMap[r.stop_id ?? ""]?.name ?? "–"}</Td>
                  <Td><StateBadge state={r.state} />{r.resolved_reason && <span className="block text-xs text-ink-3">{r.resolved_reason}</span>}</Td>
                  <Td className="tabular">{fmtTime(r.board_at)}</Td>
                  <Td className="tabular">{fmtTime(r.drop_at)}</Td>
                  <Td className="text-right">{canWrite && <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "mark", row: r })}>Update</Button>}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="Scan log" padded={false}>
            {scans.length === 0 ? <p className="px-4 py-6 text-ink-3">No scans yet.</p> : (
              <Table head={["Time", "Student", "Action", "Method", "Stop"]}>
                {scans.map((e) => (
                  <tr key={e.id} className={e.result !== "ok" ? "text-ink-3" : ""}>
                    <Td className="tabular">{fmtTime(e.device_ts ?? e.server_ts)}</Td>
                    <Td>{e.student_id ? `${studentMap[e.student_id]?.first_name ?? "Other student"}` : "Unknown card"}</Td>
                    <Td>{e.result === "ok" ? (e.type === "BOARD" ? "Boarded" : "Got off") : <Badge tone={e.result === "duplicate" ? "muted" : "alert"}>{e.result.replace(/_/g, " ")}</Badge>}</Td>
                    <Td>{{ qr: "QR scan", manual: "Manual", bulk: "Group check-out", admin: "Admin" }[e.method] ?? e.method}{e.reason ? <span className="block text-xs">{e.reason}</span> : null}</Td>
                    <Td>{stopMap[e.stop_id ?? ""]?.name ?? "–"}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <div className="overflow-hidden neu rounded-[20px]">
            <MapView className="h-80 w-full" markers={markers} track={track} fitKey={trip.id + track.length} />
          </div>
          <Panel title="Stops">
            <ol className="space-y-2">
              {routeStops.map((r) => {
                const v = visits.find((x) => x.stop_id === r.stop_id);
                const planned = trip.scheduled_start ? new Date(new Date(trip.scheduled_start).getTime() + r.planned_offset_min * 60000).toISOString() : null;
                const late = v && planned ? Math.round((new Date(v.entered_at).getTime() - new Date(planned).getTime()) / 60000) : null;
                return (
                  <li key={r.stop_id} className="flex items-center gap-3">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-extrabold ${v ? "border-safe bg-safe text-white" : "border-line"}`}>{r.seq}</span>
                    <div className="flex-1"><div className="font-semibold">{stopMap[r.stop_id]?.name}</div>
                      <div className="text-xs text-ink-3">planned {fmtTime(planned)}{v ? ` · arrived ${fmtTime(v.entered_at)}` : ""}{late != null && late > 3 ? ` · ${late} min late` : ""}</div></div>
                  </li>
                );
              })}
            </ol>
          </Panel>
          <Panel title="Exceptions & incidents">
            {exceptions.length + incidents.length === 0 ? <p className="text-ink-3">None on this trip.</p> : (
              <ul className="space-y-2 text-sm">
                {incidents.map((i) => <li key={i.id} className="rounded-lg bg-alert-soft p-2"><b>{i.type.startsWith("sos") ? `SOS: ${i.type.replace("sos_", "")}` : i.type}</b> · {fmtTime(i.created_at)}{i.note ? ` · ${i.note}` : ""} <Badge tone={i.status === "resolved" ? "safe" : "alert"}>{i.status}</Badge></li>)}
                {exceptions.map((x) => <li key={x.id} className="rounded-lg bg-surface p-2"><b>{EXCEPTION_LABEL[x.code] ?? x.code}</b> · {fmtTime(x.opened_at)}<div>{x.message}</div><Badge tone={x.status === "resolved" ? "safe" : "warn"}>{x.status}</Badge>{x.resolution_note && <span className="ml-1 text-ink-3">{x.resolution_note}</span>}</li>)}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <MarkModal row={action?.kind === "mark" ? action.row : undefined} trip={trip} onClose={() => setAction(null)} onDone={refresh} />
      <ForceModal open={action?.kind === "force"} trip={trip} onClose={() => setAction(null)} onDone={refresh} />
      <BroadcastModal open={action?.kind === "broadcast"} trip={trip} onClose={() => setAction(null)} />
      <TransferModal open={action?.kind === "transfer"} trip={trip} manifest={manifest} onClose={() => setAction(null)} onDone={refresh} />
    </div>
  );
}

function MarkModal({ row, trip, onClose, onDone }: { row?: MRow; trip: Trip; onClose: () => void; onDone: () => void }) {
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState("");
  if (!row) return null;
  const options: { v: string; label: string; ok: CustodyState[] }[] = [
    { v: "scan:BOARD", label: "Mark as boarded", ok: ["EXPECTED", "MISSED", "NO_SHOW", "ABSENT_NOTIFIED"] },
    { v: "scan:DEBOARD", label: trip.direction === "MORNING" ? "Mark as reached school" : "Mark as dropped at stop", ok: ["ON_BOARD", "UNCONFIRMED", "EXPECTED", "MISSED"] },
    { v: "res:handed_over", label: "Handed over to guardian", ok: ["ON_BOARD"] },
    { v: "res:parent_pickup", label: "Parent picked up from school", ok: ["EXPECTED", "MISSED"] },
    { v: "res:absent", label: "Absent today", ok: ["EXPECTED", "MISSED", "NO_SHOW"] },
    { v: "res:no_show", label: "Did not come (alert parent)", ok: ["EXPECTED"] },
  ];
  async function save() {
    try {
      const [kind, val] = choice.split(":");
      const res = kind === "scan"
        ? await rpc<{ ok: boolean; result?: string }>("admin_mark_scan", { p_trip_id: trip.id, p_student_id: row!.student_id, p_type: val, p_reason: reason })
        : await rpc<{ ok: boolean; code?: string }>("admin_resolve_student", { p_trip_id: trip.id, p_student_id: row!.student_id, p_resolution: val, p_note: reason });
      if (!res.ok) throw new Error(("result" in res && res.result) || ("code" in res && res.code) || "Not allowed");
      toast.success("Updated. Parents are notified where relevant."); onDone(); onClose(); setChoice(""); setReason("");
    } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <Modal open onClose={onClose} title={`Update ${row.students.first_name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!choice || !reason.trim()} onClick={save}>Save</Button></>}>
      <p className="mb-3 text-sm">Current status: <StateBadge state={row.state} /></p>
      <div className="space-y-3">
        <Field label="What happened?"><Select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choose…</option>{options.filter((o) => o.ok.includes(row.state)).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </Select></Field>
        <Field label="Reason (saved in the audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Attendant phone battery died" /></Field>
      </div>
    </Modal>
  );
}

function ForceModal({ open, trip, onClose, onDone }: { open: boolean; trip: Trip; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  async function save() {
    try { await rpc("force_complete_trip", { p_trip_id: trip.id, p_reason: reason }); toast.success("Trip closed"); onDone(); onClose(); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Close this trip?" footer={<><Button onClick={onClose}>Keep running</Button><Button variant="danger" disabled={!reason.trim()} onClick={save}>Close trip</Button></>}>
      <p className="mb-3 text-sm text-ink-2">Children still on the bus will be marked <b>unconfirmed</b> and raise a critical exception. Only do this if you have confirmed every child is safe.</p>
      <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

function BroadcastModal({ open, trip, onClose }: { open: boolean; trip: Trip; onClose: () => void }) {
  const [msg, setMsg] = useState("");
  async function send() {
    try { const n = await rpc<number>("broadcast_trip", { p_trip_id: trip.id, p_message: msg }); toast.success(`Queued ${n} messages`); onClose(); setMsg(""); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Message parents on this trip" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={msg.trim().length < 5} onClick={send}>Send to parents</Button></>}>
      <Field label="Message" hint="Keep it calm and factual. Parents of every child on this trip receive it.">
        <Textarea value={msg} maxLength={300} onChange={(e) => setMsg(e.target.value)} placeholder="Bus 7 has a flat tyre near Miyapur. All children are safe; a replacement bus will arrive in about 20 minutes." />
      </Field>
    </Modal>
  );
}

function TransferModal({ open, trip, manifest, onClose, onDone }: { open: boolean; trip: Trip; manifest: MRow[]; onClose: () => void; onDone: () => void }) {
  const buses = useBuses();
  const others = useQuery({
    queryKey: ["transfer-targets", trip.trip_date, trip.direction], enabled: open,
    queryFn: async () => check(await supabase.from("trips").select("*").eq("trip_date", trip.trip_date).eq("direction", trip.direction).neq("id", trip.id).in("status", ["scheduled", "active"])) as Trip[],
  });
  const busMap = byId(buses.data);
  const [target, setTarget] = useState("");
  const movable = manifest.filter((m) => ["EXPECTED", "ON_BOARD", "MISSED"].includes(m.state));
  async function go() {
    try { const n = await rpc<number>("transfer_riders", { p_from_trip: trip.id, p_to_trip: target, p_student_ids: null }); toast.success(`${n} children moved. Parents notified.`); onDone(); onClose(); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Move children to another bus" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!target} onClick={go}>Move {movable.length} children</Button></>}>
      <p className="mb-3 text-sm text-ink-2">Use this for breakdowns. Every child still expected or on this bus moves to the rescue bus's trip, and their parents get the new bus number.</p>
      <Field label="Rescue bus"><Select value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Choose a trip…</option>
        {others.data?.map((t) => <option key={t.id} value={t.id}>Bus {busMap[t.bus_id ?? ""]?.display_number ?? "?"} · {t.status === "active" ? "running" : "not started"}</option>)}
      </Select></Field>
    </Modal>
  );
}
