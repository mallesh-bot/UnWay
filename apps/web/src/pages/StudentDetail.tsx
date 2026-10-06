import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Pencil, Printer, RefreshCw } from "lucide-react";
import { useAuth } from "../lib/auth";
import { check, rpc, supabase } from "../lib/supabase";
import type { Assignment, CustodyState, Direction, Student } from "../lib/types";
import { addDays, directionLabel, fmtDate, fmtTime, todayISO } from "../lib/format";
import { byId, useRouteStops, useRoutes, useStops } from "../lib/queries";
import { getCredentials, qrDataUrl } from "../lib/qr";
import { Avatar, Badge, Button, ErrorBox, Field, Input, Loading, Panel, Select, StateBadge } from "../components/ui";
import StudentForm from "../components/StudentForm";
import { StudentGuardians } from "../components/Guardians";

export default function StudentDetail() {
  const { id } = useParams<{ id: string }>();
  const { canWrite } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const student = useQuery({
    queryKey: ["student", id],
    queryFn: async () => check(await supabase.from("students").select("*").eq("id", id!).single()) as Student,
  });
  if (student.isLoading) return <Loading />;
  if (student.error) return <ErrorBox error={student.error} />;
  const s = student.data!;

  return (
    <div className="space-y-5">
      <Link to="/students" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-3 hover:text-ink"><ArrowLeft size={15} /> Students</Link>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar src={s.photo_thumb} name={`${s.first_name} ${s.last_name}`} size={72} />
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold">{s.first_name} {s.last_name}</h1>
          <p className="text-ink-3">
            Class {[s.class_name, s.section].filter(Boolean).join("-") || "–"} · Adm. {s.admission_no ?? "–"}
            {s.transport_status !== "active" && <Badge tone="warn" className="ml-2">{s.transport_status.replace("_", " ")}</Badge>}
          </p>
          {s.special_care_note && <p className="mt-1 text-sm font-semibold text-warn">Special care: {s.special_care_note}</p>}
        </div>
        {canWrite && <Button onClick={() => setEditing(true)}><Pencil size={15} /> Edit</Button>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Panel title="Bus routes"><Assignments studentId={s.id} /></Panel>
          <Panel title="Parents & guardians"><StudentGuardians studentId={s.id} /></Panel>
          <Panel title="Journey history"><Journey studentId={s.id} /></Panel>
        </div>
        <div className="space-y-5">
          {canWrite && <Panel title="Transport card"><QrCard student={s} onReissued={() => qc.invalidateQueries({ queryKey: ["student", id] })} /></Panel>}
          <Panel title="Absences"><Absences studentId={s.id} /></Panel>
        </div>
      </div>
      <StudentForm open={editing} onClose={() => setEditing(false)} student={s} onSaved={() => qc.invalidateQueries({ queryKey: ["student", id] })} />
    </div>
  );
}

function Assignments({ studentId }: { studentId: string }) {
  const q = useQuery({
    queryKey: ["assignments", studentId],
    queryFn: async () => check(await supabase.from("transport_assignments").select("*").eq("student_id", studentId).is("effective_to", null)) as Assignment[],
  });
  if (q.isLoading) return <Loading />;
  return (
    <div className="space-y-4">
      <AssignmentRow studentId={studentId} dir="MORNING" current={q.data?.find((a) => a.direction === "MORNING")} />
      <AssignmentRow studentId={studentId} dir="AFTERNOON" current={q.data?.find((a) => a.direction === "AFTERNOON")} />
    </div>
  );
}

function AssignmentRow({ studentId, dir, current }: { studentId: string; dir: Direction; current?: Assignment }) {
  const { canWrite } = useAuth();
  const routes = useRoutes();
  const stops = useStops();
  const rs = useRouteStops();
  const qc = useQueryClient();
  const stopMap = byId(stops.data);
  const [route, setRoute] = useState(current?.route_id ?? "");
  const [stop, setStop] = useState(current?.stop_id ?? "");
  useEffect(() => { setRoute(current?.route_id ?? ""); setStop(current?.stop_id ?? ""); }, [current?.route_id, current?.stop_id]);
  const routeStops = (rs.data ?? []).filter((x) => x.route_id === route).sort((a, b) => a.seq - b.seq);
  const dirty = route !== (current?.route_id ?? "") || stop !== (current?.stop_id ?? "");
  async function save() {
    try {
      await rpc("set_assignment", { p_student_id: studentId, p_direction: dir, p_route_id: route || null, p_stop_id: stop || null });
      toast.success(`${directionLabel(dir)} route saved`);
      qc.invalidateQueries({ queryKey: ["assignments", studentId] }); qc.invalidateQueries({ queryKey: ["assignments-open"] });
    } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <div className="grid items-end gap-3 sm:grid-cols-[120px_1fr_1fr_auto]">
      <div className="pb-2 font-bold">{directionLabel(dir)}</div>
      <Field label={dir === "MORNING" ? "Route (home → school)" : "Route (school → home)"}>
        <Select disabled={!canWrite} value={route} onChange={(e) => { setRoute(e.target.value); setStop(""); }}>
          <option value="">No bus</option>
          {routes.data?.filter((r) => r.direction === dir).map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
        </Select>
      </Field>
      <Field label={dir === "MORNING" ? "Pickup stop" : "Drop stop"}>
        <Select disabled={!canWrite || !route} value={stop} onChange={(e) => setStop(e.target.value)}>
          <option value="">Choose stop</option>
          {routeStops.map((x) => <option key={x.stop_id} value={x.stop_id}>{x.seq}. {stopMap[x.stop_id]?.name}</option>)}
        </Select>
      </Field>
      {canWrite && <Button variant="primary" disabled={!dirty || (!!route && !stop)} onClick={save}>Save</Button>}
    </div>
  );
}

function QrCard({ student, onReissued }: { student: Student; onReissued: () => void }) {
  const nav = useNavigate();
  const [img, setImg] = useState<string | null>(null);
  const [ver, setVer] = useState<number>(student.cred_version);
  useEffect(() => {
    getCredentials([student.id]).then(async ([c]) => { setImg(await qrDataUrl(c.payload)); setVer(c.version); }).catch((e) => toast.error(e.message));
  }, [student.id, student.cred_version]);
  async function reissue() {
    if (!confirm("Replace this card? The old card will stop working on all buses immediately.")) return;
    try { await getCredentials([student.id], true); toast.success("New card issued. Print and hand it over."); onReissued(); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <div className="space-y-3 text-center">
      {img ? <img src={img} alt="Transport QR code" className="mx-auto w-48 rounded-lg border border-line" /> : <div className="mx-auto h-48 w-48 animate-pulse rounded-lg bg-surface" />}
      <p className="text-sm text-ink-3">Card version {ver}. The code contains no personal details.</p>
      <div className="flex justify-center gap-2">
        <Button size="sm" onClick={() => nav(`/cards?ids=${student.id}`)}><Printer size={15} /> Print card</Button>
        <Button size="sm" variant="ghost" onClick={reissue}><RefreshCw size={15} /> Replace lost card</Button>
      </div>
    </div>
  );
}

function Absences({ studentId }: { studentId: string }) {
  const { org, canWrite } = useAuth();
  const qc = useQueryClient();
  const [date, setDate] = useState(addDays(todayISO(), 1));
  const [legs, setLegs] = useState("BOTH");
  const q = useQuery({
    queryKey: ["absences", studentId],
    queryFn: async () => check(await supabase.from("absences").select("*").eq("student_id", studentId).gte("date", addDays(todayISO(), -30)).order("date", { ascending: false })) as { id: string; date: string; legs: string; source: string; cancelled_at: string | null }[],
  });
  async function add() {
    const { error } = await supabase.from("absences").insert({ org_id: org!.id, student_id: studentId, date, legs, source: "admin" });
    if (error) toast.error(error.message); else { toast.success("Absence recorded"); qc.invalidateQueries({ queryKey: ["absences", studentId] }); }
  }
  async function cancel(id: string) {
    await supabase.from("absences").update({ cancelled_at: new Date().toISOString() }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["absences", studentId] });
  }
  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex items-end gap-2">
          <Field label="Date" className="flex-1"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Trips"><Select value={legs} onChange={(e) => setLegs(e.target.value)}><option value="BOTH">Both</option><option value="AM">Morning</option><option value="PM">Afternoon</option></Select></Field>
          <Button onClick={add}>Add</Button>
        </div>
      )}
      <ul className="divide-y divide-line text-sm">
        {(q.data ?? []).map((a) => (
          <li key={a.id} className="flex items-center justify-between py-2">
            <span className={a.cancelled_at ? "text-ink-3 line-through" : ""}>{fmtDate(a.date)} · {a.legs === "BOTH" ? "both trips" : a.legs === "AM" ? "morning" : "afternoon"}
              <span className="block text-xs text-ink-3">{a.source.startsWith("parent") ? "Told by parent" : "Added by school"}</span></span>
            {!a.cancelled_at && canWrite && a.date >= todayISO() && <Button size="sm" variant="ghost" onClick={() => cancel(a.id)}>Cancel</Button>}
          </li>
        ))}
        {q.data?.length === 0 && <li className="py-2 text-ink-3">No absences in the last 30 days.</li>}
      </ul>
    </div>
  );
}

interface JourneyTrip {
  trip_id: string; date: string; direction: Direction; route: string; bus: string | null; state: CustodyState;
  board_at: string | null; drop_at: string | null; reason: string | null;
  events: { type: string | null; method: string; result: string; at: string; stop: string | null }[];
}

function Journey({ studentId }: { studentId: string }) {
  const [from, setFrom] = useState(addDays(todayISO(), -13));
  const [to, setTo] = useState(todayISO());
  const q = useQuery({
    queryKey: ["journey", studentId, from, to],
    queryFn: () => rpc<JourneyTrip[]>("student_journey", { p_student_id: studentId, p_from: from, p_to: to }),
  });
  const byDate: Record<string, JourneyTrip[]> = {};
  for (const t of q.data ?? []) (byDate[t.date] ??= []).push(t);
  return (
    <div>
      <div className="mb-3 flex gap-2">
        <Input type="date" className="max-w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="max-w-44" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {q.isLoading ? <Loading /> : Object.keys(byDate).length === 0 ? <p className="text-ink-3">No trips in this period.</p> : (
        <ol className="space-y-4">
          {Object.entries(byDate).map(([date, trips]) => (
            <li key={date}>
              <h3 className="mb-1.5 text-sm font-bold text-ink-2">{fmtDate(date)}</h3>
              <div className="space-y-2">
                {trips.sort((a) => (a.direction === "MORNING" ? -1 : 1)).map((t) => (
                  <div key={t.trip_id} className="neu-soft rounded-2xl p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="plate">{t.bus ?? "?"}</span>
                      <Link to={`/trips/${t.trip_id}`} className="font-semibold hover:underline">{directionLabel(t.direction)} · {t.route}</Link>
                      <StateBadge state={t.state} />
                      {t.reason && <span className="text-sm text-ink-3">{t.reason}</span>}
                    </div>
                    {t.events.length > 0 && (
                      <ul className="mt-2 space-y-0.5 border-l-2 border-line pl-3 text-sm">
                        {t.events.map((e, i) => (
                          <li key={i} className={e.result !== "ok" ? "text-ink-3" : ""}>
                            <span className="tabular font-semibold">{fmtTime(e.at)}</span>{" "}
                            {e.result === "ok" ? (e.type === "BOARD" ? "Boarded" : "Got off") : `Scan rejected (${e.result.replace("_", " ")})`}
                            {e.stop ? ` at ${e.stop}` : ""}{e.method !== "qr" ? ` · ${e.method === "bulk" ? "group check-out" : "marked manually"}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
