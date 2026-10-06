import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { check, rpc, supabase } from "../lib/supabase";
import type { ExceptionRow, Incident } from "../lib/types";
import { ago, EXCEPTION_LABEL, fmtDateTime } from "../lib/format";
import { byId, useBuses, useStudentsLite } from "../lib/queries";
import { Badge, Button, Empty, Field, Loading, Modal, PageHeader, Panel, Plate, Select, Textarea, cx } from "../components/ui";

const SEV_TONE = { critical: "alert", high: "alert", medium: "warn", low: "muted", info: "muted" } as const;

export default function Exceptions() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "incidents" ? "incidents" : "exceptions";
  const [status, setStatus] = useState("open");
  return (
    <div>
      <PageHeader title="Exceptions & incidents" sub="Anything that needs a person to check. Resolve each one with a note so there is a record."
        actions={<Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="all">All (last 7 days)</option></Select>} />
      <div className="neu-inset mb-5 flex w-fit gap-1 rounded-2xl p-1.5">
        {(["exceptions", "incidents"] as const).map((t) => (
          <button key={t} onClick={() => setParams(t === "incidents" ? { tab: t } : {})} className={cx("rounded-xl px-4 py-1.5 font-semibold transition-all duration-300", tab === t ? "bg-panel text-ink shadow-[3px_3px_8px_var(--neu-dark),-3px_-3px_8px_var(--neu-light)]" : "text-ink-3 hover:text-ink")}>
            {t === "exceptions" ? "Exceptions" : "SOS & safety incidents"}
          </button>
        ))}
      </div>
      {tab === "exceptions" ? <ExceptionList status={status} /> : <IncidentList status={status} />}
    </div>
  );
}

function since7() { return new Date(Date.now() - 7 * 86400000).toISOString(); }

function ExceptionList({ status }: { status: string }) {
  const { canWrite } = useAuth();
  const qc = useQueryClient();
  const buses = useBuses(); const students = useStudentsLite();
  const busMap = byId(buses.data); const stuMap = byId(students.data);
  const q = useQuery({
    queryKey: ["exceptions", status], refetchInterval: 15_000,
    queryFn: async () => {
      let x = supabase.from("exceptions").select("*").order("opened_at", { ascending: false }).limit(300);
      x = status === "open" ? x.neq("status", "resolved") : x.gte("opened_at", since7());
      return check(await x) as ExceptionRow[];
    },
  });
  const [resolving, setResolving] = useState<ExceptionRow | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["exceptions"] }); qc.invalidateQueries({ queryKey: ["alert-counts"] }); };

  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <Panel><Empty title="All clear">No {status === "open" ? "open " : ""}exceptions.</Empty></Panel>;
  return (
    <div className="space-y-2">
      {q.data.map((x) => (
        <div key={x.id} className={cx("flex flex-wrap items-start gap-4 neu rounded-[22px] border p-5", x.status === "open" && (x.severity === "critical" || x.severity === "high") ? "border-alert/40" : "border-line")}>
          {x.bus_id && <Plate>{busMap[x.bus_id]?.display_number ?? "?"}</Plate>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{EXCEPTION_LABEL[x.code] ?? x.code}</span>
              <Badge tone={SEV_TONE[x.severity]}>{x.severity}</Badge>
              {x.status !== "open" && <Badge tone={x.status === "resolved" ? "safe" : "route"}>{x.status}</Badge>}
            </div>
            <p className="text-ink-2">{x.message}</p>
            <p className="text-sm text-ink-3">
              {fmtDateTime(x.opened_at)} ({ago(x.opened_at)})
              {x.student_id && <> · <Link className="font-semibold text-route" to={`/students/${x.student_id}`}>{stuMap[x.student_id]?.first_name ?? "Student"}</Link></>}
              {x.trip_id && <> · <Link className="font-semibold text-route" to={`/trips/${x.trip_id}`}>Trip</Link></>}
            </p>
            {x.resolution_note && <p className="mt-1 text-sm"><b>Resolution:</b> {x.resolution_note}</p>}
          </div>
          {canWrite && x.status !== "resolved" && (
            <div className="flex gap-2">
              {x.status === "open" && <Button size="sm" onClick={async () => { await rpc("ack_exception", { p_id: x.id }); refresh(); }}>I'm on it</Button>}
              <Button size="sm" variant="primary" onClick={() => setResolving(x)}>Resolve</Button>
            </div>
          )}
        </div>
      ))}
      <ResolveModal title="Resolve exception" open={!!resolving} onClose={() => setResolving(null)}
        onSave={async (note) => { await rpc("resolve_exception", { p_id: resolving!.id, p_note: note }); refresh(); }} />
    </div>
  );
}

function IncidentList({ status }: { status: string }) {
  const { canWrite } = useAuth();
  const qc = useQueryClient();
  const buses = useBuses(); const busMap = byId(buses.data);
  const q = useQuery({
    queryKey: ["incidents", status], refetchInterval: 10_000,
    queryFn: async () => {
      let x = supabase.from("incidents").select("*").order("created_at", { ascending: false }).limit(300);
      x = status === "open" ? x.neq("status", "resolved") : x.gte("created_at", since7());
      return check(await x) as Incident[];
    },
  });
  const [resolving, setResolving] = useState<Incident | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["incidents"] }); qc.invalidateQueries({ queryKey: ["alert-counts"] }); };
  const label = (t: string) => t.startsWith("sos_") ? `SOS – ${t.slice(4)}` : t === "overspeed" ? "Over speed limit" : t === "delay" ? "Delay reported" : t;

  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <Panel><Empty title="No incidents">SOS alerts, speeding and delays reported from buses appear here.</Empty></Panel>;
  return (
    <div className="space-y-2">
      {q.data.map((i) => (
        <div key={i.id} className={cx("flex flex-wrap items-start gap-4 neu rounded-[22px] border p-5", i.type.startsWith("sos") && i.status !== "resolved" ? "border-alert sos-pulse" : "border-line")}>
          {i.bus_id && <Plate>{busMap[i.bus_id]?.display_number ?? "?"}</Plate>}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="font-bold">{label(i.type)}</span><Badge tone={i.status === "resolved" ? "safe" : i.type.startsWith("sos") ? "alert" : "warn"}>{i.status}</Badge></div>
            {i.note && <p className="text-ink-2">{i.note}</p>}
            <p className="text-sm text-ink-3">{fmtDateTime(i.created_at)} ({ago(i.created_at)})
              {i.lat && <> · <a className="font-semibold text-route" href={`https://maps.google.com/?q=${i.lat},${i.lng}`} target="_blank" rel="noreferrer">Open location</a></>}
              {i.trip_id && <> · <Link className="font-semibold text-route" to={`/trips/${i.trip_id}`}>Trip</Link></>}
              {typeof i.data?.on_board === "number" && <> · {String(i.data.on_board)} children on board</>}</p>
            {i.resolution_note && <p className="mt-1 text-sm"><b>Resolution:</b> {i.resolution_note}</p>}
          </div>
          {canWrite && i.status !== "resolved" && (
            <div className="flex gap-2">
              {i.status === "open" && <Button size="sm" onClick={async () => { await rpc("ack_incident", { p_id: i.id }); refresh(); }}>Acknowledge</Button>}
              <Button size="sm" variant="primary" onClick={() => setResolving(i)}>Resolve</Button>
            </div>
          )}
        </div>
      ))}
      <ResolveModal title="Resolve incident" open={!!resolving} onClose={() => setResolving(null)}
        onSave={async (note) => { await rpc("resolve_incident", { p_id: resolving!.id, p_note: note }); refresh(); }} />
    </div>
  );
}

function ResolveModal({ open, title, onClose, onSave }: { open: boolean; title: string; onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  async function save() {
    try { await onSave(note); toast.success("Resolved"); setNote(""); onClose(); } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={note.trim().length < 3} onClick={save}>Resolve</Button></>}>
      <Field label="What happened and what was done?"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Called parent; child was at grandmother's house. Safe." /></Field>
    </Modal>
  );
}
