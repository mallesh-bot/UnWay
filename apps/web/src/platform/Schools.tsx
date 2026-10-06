import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Plus, Search } from "lucide-react";
import { useAuth } from "../lib/auth";
import { adminTool, rpc } from "../lib/supabase";
import { ago, fmtDate } from "../lib/format";
import { Badge, Button, Drawer, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Panel, Select, Table, Td, Textarea } from "../components/ui";
import { Meter } from "../components/Charts";
import MapView from "../components/MapView";
import { StatusBadge } from "./Overview";
import { WHATSAPP_RATE_INR, type SchoolRow } from "./types";

export default function Schools() {
  const schools = useQuery({ queryKey: ["platform-schools"], queryFn: () => rpc<SchoolRow[]>("platform_schools") });
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(false);
  const openId = params.get("open");
  const open = (schools.data ?? []).find((s) => s.id === openId) ?? null;

  const rows = useMemo(() => (schools.data ?? []).filter((s) =>
    (status === "all" || s.status === status) && (!q || `${s.name} ${s.short_code} ${s.contact_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [schools.data, q, status]);

  return (
    <div>
      <PageHeader eyebrow="UnWay console" title="Schools" sub="Every school on UnWay. Open one to change its plan, invite its admin or see its dashboard."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Add school</Button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <label className="flex h-10 w-full max-w-xs items-center gap-2 neu-inset rounded-xl px-3.5">
          <Search size={16} className="text-ink-3" /><input className="w-full bg-transparent outline-none" placeholder="Search schools" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option><option value="trial">Trial</option><option value="active">Active</option><option value="suspended">Paused</option>
        </Select>
      </div>
      <Panel padded={false}>
        {schools.isLoading ? <Loading /> : rows.length === 0 ? <Empty title="No schools yet" action={<Button variant="primary" onClick={() => setCreating(true)}>Add the first school</Button>}>Schools can also sign up themselves; they start as a trial.</Empty> : (
          <Table head={["School", "Status", "Students", "Buses", "Parents connected", "Trips (7 d)", "Alerts", "Last activity"]}>
            {rows.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-surface/60" onClick={() => setParams({ open: s.id })}>
                <Td><span className="font-semibold">{s.name}</span><span className="block text-xs text-ink-3">{s.short_code} · {s.plan} · since {fmtDate(s.created_at.slice(0, 10))}</span></Td>
                <Td><StatusBadge status={s.status} /></Td>
                <Td className="tabular">{s.students}</Td>
                <Td className="tabular">{s.buses} <span className="text-xs text-ink-3">({s.devices} phones)</span></Td>
                <Td className="min-w-40"><Meter value={s.connected} max={Math.max(s.guardians, 1)} tone={s.guardians && s.connected / s.guardians < 0.5 ? "warn" : "safe"} /><span className="text-xs text-ink-3 tabular">{s.connected} of {s.guardians}</span></Td>
                <Td className="tabular">{s.trips_7d}</Td>
                <Td>{s.open_exceptions ? <Badge tone="alert">{s.open_exceptions}</Badge> : <span className="text-ink-3">0</span>}</Td>
                <Td className="text-ink-3">{ago(s.last_activity)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <SchoolDrawer school={open} onClose={() => { params.delete("open"); setParams(params); }} />
      <CreateSchool open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setParams({ open: id }); }} />
    </div>
  );
}

function SchoolDrawer({ school, onClose }: { school: SchoolRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [f, setF] = useState({ status: "trial", plan: "pilot", notes: "", contact_name: "", contact_phone: "", contact_email: "" });
  const [invite, setInvite] = useState({ email: "", name: "" });
  useEffect(() => {
    if (school) setF({ status: school.status, plan: school.plan, notes: school.notes ?? "", contact_name: school.contact_name ?? "", contact_phone: school.contact_phone ?? "", contact_email: school.contact_email ?? "" });
    setInvite({ email: school?.contact_email ?? "", name: school?.contact_name ?? "" });
  }, [school]);
  if (!school) return null;

  async function save() {
    try {
      await rpc("platform_update_school", { p_org: school!.id, p_status: f.status, p_plan: f.plan, p_notes: f.notes, p_contact_name: f.contact_name || null, p_contact_phone: f.contact_phone || null, p_contact_email: f.contact_email || null });
      toast.success("School updated"); qc.invalidateQueries({ queryKey: ["platform-schools"] }); qc.invalidateQueries({ queryKey: ["platform-overview"] });
    } catch (e) { toast.error((e as Error).message); }
  }
  async function sendInvite() {
    try {
      await adminTool({ action: "platform_invite_admin", org_id: school!.id, email: invite.email, name: invite.name || null, redirect_to: window.location.origin });
      toast.success(`Invite sent to ${invite.email}`); qc.invalidateQueries({ queryKey: ["platform-schools"] });
    } catch (e) { toast.error((e as Error).message); }
  }
  async function viewAs() {
    try { await rpc("platform_view_school", { p_org: school!.id }); qc.clear(); await refresh(); nav("/"); }
    catch (e) { toast.error((e as Error).message); }
  }
  const fact = (label: string, value: ReactNode) => <div className="rounded-xl bg-surface p-3"><div className="text-xl font-extrabold tabular">{value}</div><div className="text-xs font-semibold text-ink-3">{label}</div></div>;

  return (
    <Drawer open onClose={onClose} title={school.name} wide
      footer={<><Button onClick={viewAs}><ExternalLink size={15} /> Open school dashboard</Button><Button variant="primary" onClick={save}>Save changes</Button></>}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {fact("Students", school.students)}{fact("Buses / phones", `${school.buses} / ${school.devices}`)}
          {fact("Parents connected", `${school.connected}/${school.guardians}`)}{fact("Scans (7 d)", school.scans_7d)}
          {fact("Trips (7 d)", school.trips_7d)}{fact("Messages (30 d)", school.messages_30d)}
          {fact("WhatsApp cost (30 d)", `₹${(school.whatsapp_30d * WHATSAPP_RATE_INR).toFixed(0)}`)}{fact("Open alerts", school.open_exceptions)}
        </div>

        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" hint="Paused schools' bus phones and parent messages stop.">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="trial">Trial</option><option value="active">Active</option><option value="suspended">Paused</option>
            </Select>
          </Field>
          <Field label="Plan"><Select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
            {["pilot", "free", "basic", "standard", "premium"].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </Select></Field>
          <Field label="Contact person"><Input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
          <Field label="Contact phone"><Input value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
          <Field label="Contact email" className="sm:col-span-2"><Input type="email" value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></Field>
          <Field label="Notes (only the UnWay team sees these)" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </section>

        <section>
          <h3 className="mb-2 font-bold">People with access</h3>
          {school.admins.length === 0 ? <p className="text-sm text-ink-3">Nobody yet. Invite the school's admin below.</p> : (
            <ul className="divide-y divide-line-2 rounded-2xl neu-inset p-1">
              {school.admins.map((a, i) => <li key={i} className="flex justify-between px-3 py-2 text-sm"><span><b>{a.name ?? "–"}</b> {a.email}</span><span className="text-ink-3">{a.role.replace("_", " ")}</span></li>)}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Invite a school admin by email" className="min-w-56 flex-1"><Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
            <Field label="Name" className="w-40"><Input className="w-40" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} /></Field>
            <Button disabled={!invite.email.includes("@")} onClick={sendInvite}>Send invite</Button>
          </div>
        </section>
      </div>
    </Drawer>
  );
}

function CreateSchool({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", code: "", desk: "", contact_name: "", contact_phone: "", contact_email: "", plan: "pilot", status: "trial", invite: true });
  const [pos, setPos] = useState<[number, number] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!pos) return setError(new Error("Click the map to mark the school."));
    setBusy(true);
    try {
      const id = await rpc<string>("platform_create_school", {
        p_name: f.name, p_short_code: f.code, p_lat: pos[0], p_lng: pos[1], p_desk_phone: f.desk || null,
        p_contact_name: f.contact_name || null, p_contact_phone: f.contact_phone || null, p_contact_email: f.contact_email || null, p_plan: f.plan, p_status: f.status,
      });
      if (f.invite && f.contact_email.includes("@")) {
        await adminTool({ action: "platform_invite_admin", org_id: id, email: f.contact_email, name: f.contact_name || null, redirect_to: window.location.origin })
          .then(() => toast.success(`Invite sent to ${f.contact_email}`)).catch((err) => toast.error(`School created, but the invite failed: ${(err as Error).message}`));
      }
      toast.success("School created");
      qc.invalidateQueries({ queryKey: ["platform-schools"] }); qc.invalidateQueries({ queryKey: ["platform-overview"] });
      onCreated(id);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add a school">
      <form onSubmit={submit} className="space-y-3">
        <Field label="School name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Short code" hint="3–6 letters, printed in QR cards"><Input required pattern="[A-Za-z0-9]{3,6}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Transport desk phone"><Input value={f.desk} onChange={(e) => setF({ ...f, desk: e.target.value })} /></Field>
        </div>
        <div>
          <span className="mb-1 block text-sm font-semibold text-ink-2">Location {pos ? "✓" : "(click the map)"}</span>
          <MapView className="h-48 w-full rounded-2xl neu-inset p-1" zoom={10} center={[17.385, 78.4867]}
            markers={pos ? [{ id: "s", kind: "school", lat: pos[0], lng: pos[1], draggable: true }] : []}
            onMapClick={(lat, lng) => setPos([lat, lng])} onMarkerDrag={(_, lat, lng) => setPos([lat, lng])} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact person"><Input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
          <Field label="Contact phone"><Input value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
        </div>
        <Field label="Contact email"><Input type="email" value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={f.invite} onChange={(e) => setF({ ...f, invite: e.target.checked })} /> Email them an invite to be the school admin</label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plan"><Select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>{["pilot", "free", "basic", "standard", "premium"].map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="trial">Trial</option><option value="active">Active</option></Select></Field>
        </div>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2 pt-1"><Button type="button" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy}>{busy ? "Creating…" : "Create school"}</Button></div>
      </form>
    </Modal>
  );
}
