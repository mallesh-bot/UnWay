import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Plus, Smartphone, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth";
import { check, friendlyError, rpc, supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/supabase";
import type { Bus, Crew, Device } from "../lib/types";
import { ago, fmtDate } from "../lib/format";
import { useBuses, useCrew } from "../lib/queries";
import { qrDataUrl } from "../lib/qr";
import { Badge, Button, Drawer, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Panel, Plate, Select, Table, Td, cx } from "../components/ui";

export default function Buses() {
  const [tab, setTab] = useState<"buses" | "crew">("buses");
  return (
    <div>
      <PageHeader title="Buses & crew" sub="Each bus has its own phone and account, so changing drivers never needs setup." />
      <div className="neu-inset mb-5 flex gap-1 rounded-2xl p-1.5 sm:w-fit">
        {(["buses", "crew"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("rounded-xl px-4 py-1.5 font-semibold transition-all duration-300", tab === t ? "bg-panel text-ink shadow-[3px_3px_8px_var(--neu-dark),-3px_-3px_8px_var(--neu-light)]" : "text-ink-3 hover:text-ink")}>
            {t === "buses" ? "Buses" : "Drivers & attendants"}
          </button>
        ))}
      </div>
      {tab === "buses" ? <BusList /> : <CrewList />}
    </div>
  );
}

function BusList() {
  const { canWrite } = useAuth();
  const qc = useQueryClient();
  const buses = useBuses();
  const devices = useQuery({
    queryKey: ["devices"], refetchInterval: 30_000,
    queryFn: async () => check(await supabase.from("devices").select("id,bus_id,model,app_version,paired_at,last_seen_at,battery,revoked_at").is("revoked_at", null)) as Device[],
  });
  const [edit, setEdit] = useState<Bus | null | "new">(null);
  const [pair, setPair] = useState<Bus | null>(null);

  async function unpair(d: Device) {
    if (!confirm("Unpair this phone? It will be signed out and stop working for this bus.")) return;
    try { await rpc("revoke_device", { p_device_id: d.id }); toast.success("Phone unpaired"); qc.invalidateQueries({ queryKey: ["devices"] }); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <>
      <div className="mb-3 flex justify-end">{canWrite && <Button variant="primary" onClick={() => setEdit("new")}><Plus size={16} /> Add bus</Button>}</div>
      <Panel padded={false}>
        {buses.isLoading ? <Loading /> : !buses.data?.length ? (
          <Empty title="No buses yet" action={canWrite && <Button variant="primary" onClick={() => setEdit("new")}>Add your first bus</Button>}>Add each bus, then pair the phone that rides on it.</Empty>
        ) : (
          <Table head={["Bus", "Registration", "Seats", "Status", "Bus phone", ""]}>
            {buses.data.map((b) => {
              const d = devices.data?.find((x) => x.bus_id === b.id);
              return (
                <tr key={b.id}>
                  <Td><Plate>{b.display_number}</Plate></Td>
                  <Td className="tabular">{b.registration_no ?? "–"}</Td>
                  <Td className="tabular">{b.capacity}</Td>
                  <Td>{b.status === "active" ? <Badge tone="safe">In service</Badge> : <Badge tone="warn">{b.status}</Badge>}</Td>
                  <Td>{d ? <span><span className="font-semibold">{d.model ?? "Android"}</span><span className="block text-xs text-ink-3">seen {ago(d.last_seen_at)}{d.battery != null ? ` · ${d.battery}%` : ""} · v{d.app_version ?? "?"}</span></span> : <Badge tone="warn">Not paired</Badge>}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {canWrite && <>
                      <Button size="sm" onClick={() => setPair(b)}><Smartphone size={14} /> {d ? "Pair new phone" : "Pair phone"}</Button>{" "}
                      {d && <Button size="sm" variant="ghost" onClick={() => unpair(d)}>Unpair</Button>}{" "}
                      <Button size="sm" variant="ghost" onClick={() => setEdit(b)}>Edit</Button>
                    </>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>
      <BusForm bus={edit === "new" ? null : edit} open={edit !== null} onClose={() => setEdit(null)} />
      <PairModal bus={pair} onClose={() => { setPair(null); qc.invalidateQueries({ queryKey: ["devices"] }); }} />
    </>
  );
}

function BusForm({ bus, open, onClose }: { bus: Bus | null; open: boolean; onClose: () => void }) {
  const { org } = useAuth();
  const qc = useQueryClient();
  const crew = useCrew();
  const [f, setF] = useState<Partial<Bus>>({});
  const [crewIds, setCrewIds] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setF(bus ?? { capacity: 40, status: "active" }); setError(null);
    if (bus) supabase.from("bus_crew").select("crew_id").eq("bus_id", bus.id).then(({ data }) => setCrewIds((data ?? []).map((x) => x.crew_id as string)));
    else setCrewIds([]);
  }, [bus, open]);
  async function save(e: FormEvent) {
    e.preventDefault(); setError(null);
    try {
      const row = { org_id: org!.id, display_number: (f.display_number ?? "").trim(), registration_no: f.registration_no?.trim() || null, capacity: Number(f.capacity) || 40, status: f.status ?? "active", notes: f.notes ?? null };
      let id = bus?.id;
      if (id) { const { error } = await supabase.from("buses").update(row).eq("id", id); if (error) throw error; }
      else { const { data, error } = await supabase.from("buses").insert(row).select("id").single(); if (error) throw error; id = data.id; }
      await supabase.from("bus_crew").delete().eq("bus_id", id!);
      if (crewIds.length) { const { error } = await supabase.from("bus_crew").insert(crewIds.map((c) => ({ org_id: org!.id, bus_id: id, crew_id: c }))); if (error) throw error; }
      toast.success("Bus saved"); qc.invalidateQueries({ queryKey: ["buses"] }); onClose();
    } catch (err) { setError(new Error(friendlyError((err as Error).message))); }
  }
  return (
    <Drawer open={open} onClose={onClose} title={bus ? `Edit bus ${bus.display_number}` : "Add bus"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" form="bus-form">Save bus</Button></>}>
      <form id="bus-form" onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bus number" hint="What kids & parents call it, e.g. 7"><Input required value={f.display_number ?? ""} onChange={(e) => setF({ ...f, display_number: e.target.value })} /></Field>
          <Field label="Registration no."><Input value={f.registration_no ?? ""} onChange={(e) => setF({ ...f, registration_no: e.target.value.toUpperCase() })} placeholder="TS09AB1234" /></Field>
          <Field label="Seats"><Input type="number" min={1} value={f.capacity ?? 40} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} /></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Bus["status"] })}><option value="active">In service</option><option value="maintenance">Maintenance</option><option value="retired">Retired</option></Select></Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink-2">Crew who can sign in on this bus</legend>
          <p className="mb-2 text-xs text-ink-3">If none are ticked, every active crew member can sign in.</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {crew.data?.filter((c) => c.active).map((c) => (
              <label key={c.id} className="flex items-center gap-2 neu-soft rounded-xl px-3 py-2">
                <input type="checkbox" checked={crewIds.includes(c.id)} onChange={(e) => setCrewIds(e.target.checked ? [...crewIds, c.id] : crewIds.filter((x) => x !== c.id))} />
                {c.name} <span className="text-xs text-ink-3">{c.role}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorBox error={error} />
      </form>
    </Drawer>
  );
}

function PairModal({ bus, onClose }: { bus: Bus | null; onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setCode(null); setImg(null); setError(null);
    if (!bus) return;
    rpc<{ code: string }>("create_pairing_code", { p_bus_id: bus.id }).then(async (r) => {
      setCode(r.code);
      setImg(await qrDataUrl(JSON.stringify({ t: "unway-pair", u: SUPABASE_URL, k: SUPABASE_ANON_KEY, c: r.code }), 420));
    }).catch(setError);
  }, [bus]);
  return (
    <Modal open={!!bus} onClose={onClose} title={`Pair phone for bus ${bus?.display_number ?? ""}`} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <ErrorBox error={error} />
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-ink-2">
        <li>Install the UnWay Bus app on the bus phone.</li>
        <li>Open it and tap <b>Scan pairing code</b>.</li>
        <li>Point the camera at this code. It expires in 15 minutes.</li>
      </ol>
      {img ? <img src={img} alt="Pairing QR code" className="mx-auto w-64 rounded-lg border border-line" /> : <div className="mx-auto h-64 w-64 animate-pulse rounded-lg bg-surface" />}
      {code && <p className="mt-3 text-center">Or type the code: <span className="font-extrabold tracking-widest tabular text-lg">{code}</span></p>}
      <p className="mt-2 text-center text-xs text-ink-3">Pairing a new phone signs out the old one.</p>
    </Modal>
  );
}

type NewPin = { name: string; role: string; pin: string; bus: string | null };

export function PinsModal({ pins, onClose }: { pins: NewPin[] | null; onClose: () => void }) {
  return (
    <Modal open={!!pins} onClose={onClose} title="New crew PINs"
      footer={<><Button onClick={() => window.print()}>Print</Button><Button variant="primary" onClick={onClose}>Done</Button></>}>
      <p className="mb-3 text-sm text-ink-2">Share each PIN privately. PINs are stored scrambled, so this is the only time they're shown.</p>
      <ul className="divide-y divide-line-2">
        {(pins ?? []).map((p, i) => (
          <li key={i} className="flex items-center justify-between py-2">
            <span><b>{p.name}</b> <span className="text-sm text-ink-3">{p.role}{p.bus ? ` · Bus ${p.bus}` : ""}</span></span>
            <span className="rounded-md bg-bus-soft px-2.5 py-0.5 text-lg font-extrabold tracking-widest tabular">{p.pin}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function CrewList() {
  const { canWrite } = useAuth();
  const crew = useCrew();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Crew | null | "new">(null);
  const [pins, setPins] = useState<NewPin[] | null>(null);
  const pinStatus = useQuery({ queryKey: ["crew-pins"], queryFn: () => rpc<{ id: string; has_pin: boolean }[]>("crew_pin_status") });
  const hasPin = Object.fromEntries((pinStatus.data ?? []).map((p) => [p.id, p.has_pin]));
  const missing = (crew.data ?? []).filter((c) => c.active && hasPin[c.id] === false).length;
  async function generate() {
    try { setPins(await rpc<NewPin[]>("auto_crew_pins")); qc.invalidateQueries({ queryKey: ["crew-pins"] }); qc.invalidateQueries({ queryKey: ["setup-status"] }); }
    catch (e) { toast.error((e as Error).message); }
  }
  const soon = (d: string | null) => d && new Date(d).getTime() - Date.now() < 30 * 86400000;
  return (
    <>
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        {canWrite && missing > 0 && <Button variant="bus" onClick={generate}><Sparkles size={16} /> Create PINs for {missing} crew</Button>}
        {canWrite && <Button variant="primary" onClick={() => setEdit("new")}><Plus size={16} /> Add crew member</Button>}
      </div>
      <PinsModal pins={pins} onClose={() => setPins(null)} />
      <Panel padded={false}>
        {crew.isLoading ? <Loading /> : !crew.data?.length ? (
          <Empty title="No crew yet" action={canWrite && <Button variant="primary" onClick={() => setEdit("new")}>Add a driver or attendant</Button>}>Crew pick their name and enter a PIN on the bus phone before each trip.</Empty>
        ) : (
          <Table head={["Name", "Role", "Phone", "PIN", "Licence", "Medical check", ""]}>
            {crew.data.map((c) => (
              <tr key={c.id} className={c.active ? "" : "opacity-50"}>
                <Td className="font-semibold">{c.name}</Td>
                <Td>{c.role === "driver" ? "Driver" : "Attendant"}</Td>
                <Td className="tabular">{c.phone ?? "–"}</Td>
                <Td>{hasPin[c.id] === false ? <Badge tone="warn">No PIN</Badge> : hasPin[c.id] ? <Badge tone="safe">Set</Badge> : "–"}</Td>
                <Td>{c.licence_no ?? "–"}{c.licence_valid_until && <span className={cx("block text-xs", soon(c.licence_valid_until) ? "font-bold text-alert" : "text-ink-3")}>valid till {fmtDate(c.licence_valid_until)}</span>}</Td>
                <Td>{fmtDate(c.medical_check_date)}</Td>
                <Td className="text-right">{canWrite && <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Edit</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <CrewForm crew={edit === "new" ? null : edit} open={edit !== null} onClose={() => setEdit(null)} />
    </>
  );
}

function CrewForm({ crew, open, onClose }: { crew: Crew | null; open: boolean; onClose: () => void }) {
  const { org } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState<Partial<Crew>>({});
  const [pin, setPin] = useState("");
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { setF(crew ?? { role: "driver", active: true }); setPin(""); setError(null); }, [crew, open]);
  async function save(e: FormEvent) {
    e.preventDefault(); setError(null);
    try {
      if (pin && !/^\d{4,6}$/.test(pin)) throw new Error("PIN must be 4–6 digits.");
      const row = { org_id: org!.id, name: (f.name ?? "").trim(), role: f.role, phone: f.phone || null, licence_no: f.licence_no || null, licence_valid_until: f.licence_valid_until || null, medical_check_date: f.medical_check_date || null, active: f.active ?? true };
      let id = crew?.id;
      if (id) { const { error } = await supabase.from("crew_members").update(row).eq("id", id); if (error) throw error; }
      else { const { data, error } = await supabase.from("crew_members").insert(row).select("id").single(); if (error) throw error; id = data.id; }
      if (pin) await rpc("set_crew_pin", { p_crew_id: id, p_pin: pin });
      else if (!crew) {
        const made = await rpc<NewPin[]>("auto_crew_pins");
        if (made.length) toast.success(`New PIN${made.length > 1 ? "s" : ""}: ${made.map((m) => `${m.name} ${m.pin}`).join(" · ")}. Share privately; shown only once.`, { duration: 30000 });
      }
      qc.invalidateQueries({ queryKey: ["crew-pins"] });
      toast.success("Crew saved"); qc.invalidateQueries({ queryKey: ["crew"] }); onClose();
    } catch (err) { setError(new Error(friendlyError((err as Error).message))); }
  }
  return (
    <Drawer open={open} onClose={onClose} title={crew ? `Edit ${crew.name}` : "Add crew member"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" form="crew-form">Save</Button></>}>
      <form id="crew-form" onSubmit={save} className="space-y-4">
        <Field label="Name"><Input required value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Crew["role"] })}><option value="driver">Driver</option><option value="attendant">Attendant / conductor</option></Select></Field>
          <Field label="Phone"><Input value={f.phone ?? ""} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          {f.role === "driver" && <>
            <Field label="Licence no."><Input value={f.licence_no ?? ""} onChange={(e) => setF({ ...f, licence_no: e.target.value })} /></Field>
            <Field label="Licence valid until"><Input type="date" value={f.licence_valid_until ?? ""} onChange={(e) => setF({ ...f, licence_valid_until: e.target.value })} /></Field>
          </>}
          <Field label="Last medical check"><Input type="date" value={f.medical_check_date ?? ""} onChange={(e) => setF({ ...f, medical_check_date: e.target.value })} /></Field>
        </div>
        <Field label={crew ? "New PIN (leave blank to keep)" : "PIN (optional)"} hint={crew ? "4–6 digits. Used to sign in on the bus phone and confirm the Empty Bus Check." : "Leave blank and UnWay creates one for you."}>
          <div className="flex items-center gap-2"><KeyRound size={16} className="text-ink-3" /><Input inputMode="numeric" pattern="\d{4,6}" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></div>
        </Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.active ?? true} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
        <ErrorBox error={error} />
      </form>
    </Drawer>
  );
}
