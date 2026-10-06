import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Printer, Upload } from "lucide-react";
import { useAuth } from "../lib/auth";
import { check, supabase } from "../lib/supabase";
import type { Assignment, Student } from "../lib/types";
import { byId, useRoutes, useStops } from "../lib/queries";
import { Avatar, Badge, Button, Empty, ErrorBox, Input, Loading, PageHeader, Panel, Select, Table, Td } from "../components/ui";
import StudentForm from "../components/StudentForm";

export default function Students() {
  const { canWrite } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");
  const [route, setRoute] = useState("");
  const [status, setStatus] = useState("active");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);

  const students = useQuery({
    queryKey: ["students"],
    queryFn: async () => check(await supabase.from("students").select("*").order("class_name").order("first_name").limit(5000)) as Student[],
  });
  const assignments = useQuery({
    queryKey: ["assignments-open"],
    queryFn: async () => check(await supabase.from("transport_assignments").select("*").is("effective_to", null)) as Assignment[],
  });
  const links = useQuery({
    queryKey: ["student-guardian-counts"],
    queryFn: async () => check(await supabase.from("student_guardians").select("student_id,guardian_id")) as { student_id: string; guardian_id: string }[],
  });
  const channels = useQuery({
    queryKey: ["active-channels"],
    queryFn: async () => check(await supabase.from("guardian_channels").select("guardian_id,channel").eq("status", "active")) as { guardian_id: string; channel: string }[],
  });
  const routes = useRoutes();
  const stops = useStops();
  const routeMap = byId(routes.data);
  const stopMap = byId(stops.data);

  const assignBy = useMemo(() => {
    const m: Record<string, { am?: Assignment; pm?: Assignment }> = {};
    for (const a of assignments.data ?? []) {
      m[a.student_id] ??= {};
      m[a.student_id][a.direction === "MORNING" ? "am" : "pm"] = a;
    }
    return m;
  }, [assignments.data]);

  const reachable = useMemo(() => {
    const gWithChannel = new Set((channels.data ?? []).map((c) => c.guardian_id));
    const out = new Set<string>();
    for (const l of links.data ?? []) if (gWithChannel.has(l.guardian_id)) out.add(l.student_id);
    return out;
  }, [channels.data, links.data]);

  const classes = useMemo(() => [...new Set((students.data ?? []).map((s) => s.class_name).filter(Boolean))].sort() as string[], [students.data]);

  const rows = (students.data ?? []).filter((s) => {
    if (status && s.transport_status !== status) return false;
    if (cls && s.class_name !== cls) return false;
    if (route) { const a = assignBy[s.id]; if (a?.am?.route_id !== route && a?.pm?.route_id !== route) return false; }
    if (q && !`${s.first_name} ${s.last_name} ${s.admission_no ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  function toggleAll() { setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id))); }
  function toggle(id: string) { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); }

  async function bulkStatus(s: string) {
    const { error } = await supabase.from("students").update({ transport_status: s }).in("id", [...sel]);
    if (error) toast.error(error.message); else { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["students"] }); setSel(new Set()); }
  }

  return (
    <div>
      <PageHeader title="Students" sub={`${students.data?.filter((s) => s.transport_status === "active").length ?? 0} use school transport`}
        actions={canWrite && <>
          <Link to="/students/import"><Button><Upload size={16} /> Import CSV</Button></Link>
          <Button variant="primary" onClick={() => setFormOpen(true)}><Plus size={16} /> Add student</Button>
        </>} />

      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name or admission no." value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-40" value={cls} onChange={(e) => setCls(e.target.value)}>
          <option value="">All classes</option>{classes.map((c) => <option key={c} value={c}>Class {c}</option>)}
        </Select>
        <Select className="max-w-56" value={route} onChange={(e) => setRoute(e.target.value)}>
          <option value="">All routes</option>{routes.data?.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
        </Select>
        <Select className="max-w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Uses bus</option><option value="suspended">Paused</option><option value="opted_out">Opted out</option>
          <option value="left">Left school</option><option value="">Everyone</option>
        </Select>
      </div>

      {sel.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-ink px-4 py-2 text-white">
          <span className="font-semibold">{sel.size} selected</span>
          <Button size="sm" onClick={() => nav(`/cards?ids=${[...sel].join(",")}`)}><Printer size={15} /> Print QR cards</Button>
          {canWrite && <Button size="sm" onClick={() => bulkStatus("suspended")}>Pause transport</Button>}
          {canWrite && <Button size="sm" onClick={() => bulkStatus("active")}>Resume transport</Button>}
          <Button size="sm" variant="ghost" className="text-white" onClick={() => setSel(new Set())}>Clear</Button>
        </div>
      )}

      <ErrorBox error={students.error} />
      <Panel padded={false}>
        {students.isLoading ? <Loading /> : rows.length === 0 ? (
          <Empty title={students.data?.length ? "No students match these filters" : "No students yet"}
            action={canWrite && !students.data?.length && <Button variant="primary" onClick={() => setFormOpen(true)}>Add your first student</Button>}>
            {!students.data?.length && "Add students one by one or import a CSV from your school records."}
          </Empty>
        ) : (
          <Table head={[<input key="all" type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll} />, "Student", "Class", "Morning", "Afternoon", "Parents"]}>
            {rows.map((s) => {
              const a = assignBy[s.id] ?? {};
              return (
                <tr key={s.id} className="hover:bg-surface/60">
                  <Td><input type="checkbox" aria-label={`Select ${s.first_name}`} checked={sel.has(s.id)} onChange={() => toggle(s.id)} /></Td>
                  <Td>
                    <Link to={`/students/${s.id}`} className="flex items-center gap-3">
                      <Avatar src={s.photo_thumb} name={`${s.first_name} ${s.last_name}`} size={34} />
                      <span><span className="font-semibold">{s.first_name} {s.last_name}</span>
                        <span className="block text-xs text-ink-3">{s.admission_no ?? "No admission no."}{s.special_care_note ? " · special care" : ""}</span></span>
                    </Link>
                  </Td>
                  <Td>{[s.class_name, s.section].filter(Boolean).join("-") || "–"}</Td>
                  <Td>{a.am ? <span>{routeMap[a.am.route_id]?.code} <span className="text-ink-3">· {stopMap[a.am.stop_id]?.name}</span></span> : <span className="text-ink-3">Not set</span>}</Td>
                  <Td>{a.pm ? <span>{routeMap[a.pm.route_id]?.code} <span className="text-ink-3">· {stopMap[a.pm.stop_id]?.name}</span></span> : <span className="text-ink-3">Not set</span>}</Td>
                  <Td>{reachable.has(s.id) ? <Badge tone="safe">Connected</Badge> : <Badge tone="warn">Not connected</Badge>}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>

      <StudentForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={(id) => { qc.invalidateQueries({ queryKey: ["students"] }); nav(`/students/${id}`); }} />
    </div>
  );
}
