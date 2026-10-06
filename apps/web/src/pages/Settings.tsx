import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth, useSettings } from "../lib/auth";
import { adminTool, check, friendlyError, supabase, TRACK_BASE_URL } from "../lib/supabase";
import type { OrgUser } from "../lib/types";
import { usePublicConfig } from "../lib/config";
import { Badge, Button, Field, Input, PageHeader, Panel, Select, Table, Td } from "../components/ui";
import MapView from "../components/MapView";
import { copy } from "../components/Guardians";

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" sub={isAdmin ? undefined : "Only school admins can change settings."} />
      <SchoolPanel />
      <PoliciesPanel />
      <ChannelsPanel />
      <AutomationSettings />
      <StaffAlertsPanel />
      <UsersPanel />
    </div>
  );
}

function SchoolPanel() {
  const { org, campus, isAdmin, refresh } = useAuth();
  const [name, setName] = useState(org?.name ?? "");
  const [phone, setPhone] = useState(campus?.desk_phone ?? "");
  const [address, setAddress] = useState(campus?.address ?? "");
  const [radius, setRadius] = useState(campus?.geofence_radius_m ?? 150);
  const [pos, setPos] = useState<[number, number] | null>(campus?.lat ? [campus.lat, campus.lng!] : null);
  async function save() {
    const a = await supabase.from("organizations").update({ name }).eq("id", org!.id);
    const b = await supabase.from("campuses").update({ desk_phone: phone || null, address: address || null, geofence_radius_m: radius, lat: pos?.[0], lng: pos?.[1] }).eq("id", campus!.id);
    if (a.error || b.error) return toast.error(friendlyError((a.error ?? b.error)!.message));
    toast.success("School details saved"); refresh();
  }
  return (
    <Panel title="School" actions={isAdmin && <Button variant="primary" size="sm" onClick={save}>Save</Button>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="School name"><Input disabled={!isAdmin} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Short code (in QR cards)"><Input disabled value={org?.short_code ?? ""} /></Field>
          <Field label="Transport desk phone" hint="Shown to parents in alerts and on cards."><Input disabled={!isAdmin} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Address"><Input disabled={!isAdmin} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          <Field label="School arrival radius (metres)" hint="Buses inside this circle count as 'at school'."><Input disabled={!isAdmin} type="number" min={50} max={1000} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /></Field>
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold text-ink-2">School gate location (click to move)</p>
          <MapView className="h-80 w-full rounded-[22px] neu-inset p-1" fitKey={campus?.id}
            markers={pos ? [{ id: "school", kind: "school", lat: pos[0], lng: pos[1], draggable: isAdmin }] : []}
            circles={pos ? [{ lat: pos[0], lng: pos[1], radius }] : []}
            onMapClick={isAdmin ? (lat, lng) => setPos([lat, lng]) : undefined} onMarkerDrag={(_, lat, lng) => setPos([lat, lng])} />
        </div>
      </div>
    </Panel>
  );
}

function useSaveSettings() {
  const { org, refresh } = useAuth();
  return async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from("organizations").update({ settings: { ...(org!.settings ?? {}), ...patch } }).eq("id", org!.id);
    if (error) toast.error(friendlyError(error.message)); else { toast.success("Settings saved"); await refresh(); }
  };
}

function PoliciesPanel() {
  const { isAdmin } = useAuth();
  const s = useSettings();
  const save = useSaveSettings();
  const [f, setF] = useState(s);
  useEffect(() => setF(s), [s.dup_window_s, s.late_start_min, s.overspeed_kmh, s.allow_bulk_deboard, s.drop_far_m, s.device_offline_min]); // eslint-disable-line
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  return (
    <Panel title="Safety rules" actions={isAdmin && <Button variant="primary" size="sm" onClick={() => save({
      dup_window_s: f.dup_window_s, late_start_min: f.late_start_min, overspeed_kmh: f.overspeed_kmh,
      allow_bulk_deboard: f.allow_bulk_deboard, drop_far_m: f.drop_far_m, device_offline_min: f.device_offline_min,
    })}>Save</Button>}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Speed limit (km/h)" hint="CBSE guideline: 40 km/h for school buses."><Input disabled={!isAdmin} type="number" value={f.overspeed_kmh} onChange={num("overspeed_kmh")} /></Field>
        <Field label="Trip late after (minutes)" hint="Alert if a trip hasn't started this long after its time."><Input disabled={!isAdmin} type="number" value={f.late_start_min} onChange={num("late_start_min")} /></Field>
        <Field label="Bus phone offline after (minutes)"><Input disabled={!isAdmin} type="number" value={f.device_offline_min} onChange={num("device_offline_min")} /></Field>
        <Field label="Ignore repeat scans within (seconds)"><Input disabled={!isAdmin} type="number" value={f.dup_window_s} onChange={num("dup_window_s")} /></Field>
        <Field label="Flag drop-offs farther than (metres) from the stop"><Input disabled={!isAdmin} type="number" value={f.drop_far_m} onChange={num("drop_far_m")} /></Field>
        <Field label="At school in the morning">
          <Select disabled={!isAdmin} value={f.allow_bulk_deboard ? "bulk" : "each"} onChange={(e) => setF({ ...f, allow_bulk_deboard: e.target.value === "bulk" })}>
            <option value="bulk">Attendant can check out everyone at once</option><option value="each">Scan every child off the bus</option>
          </Select>
        </Field>
      </div>
    </Panel>
  );
}

function ChannelsPanel() {
  const { isAdmin } = useAuth();
  const s = useSettings();
  const cfg = usePublicConfig();
  const save = useSaveSettings();
  const [ch, setCh] = useState(s.channels);
  const [track, setTrack] = useState(s.track_base_url || TRACK_BASE_URL);
  useEffect(() => { setCh(s.channels); }, [JSON.stringify(s.channels)]); // eslint-disable-line
  async function setupBot() {
    try { const r = await adminTool<{ ok: boolean; bot?: string }>({ action: "setup_telegram" }); toast.success(r.ok ? `Telegram bot @${r.bot} connected` : "Telegram rejected the webhook"); cfg.refetch(); }
    catch (e) { toast.error((e as Error).message); }
  }
  const items: { k: string; label: string; note: string; status?: React.ReactNode }[] = [
    { k: "telegram", label: "Telegram", note: "Free. Parents tap an invite link and get messages from your bot.", status: cfg.data?.telegram_bot ? <Badge tone="safe">@{cfg.data.telegram_bot}</Badge> : <Badge tone="warn">Bot not set up</Badge> },
    { k: "webpush", label: "Browser alerts", note: "Free. Parents open the invite page and allow notifications (best on Android).", status: cfg.data?.vapid_public_key ? <Badge tone="safe">Ready</Badge> : <Badge tone="warn">Keys missing</Badge> },
    { k: "whatsapp", label: "WhatsApp", note: "Paid by Meta per message (about ₹0.12 each in India). Needs approved message templates.", status: cfg.data?.whatsapp_configured ? <Badge tone="safe">Configured</Badge> : <Badge tone="warn">Not configured</Badge> },
    { k: "email", label: "Email", note: "Free tier with Resend. Good for summaries, slow for live alerts." },
  ];
  return (
    <Panel title="Parent messages" actions={isAdmin && <Button variant="primary" size="sm" onClick={() => save({ channels: ch, track_base_url: track.replace(/\/$/, "") })}>Save</Button>}>
      <div className="space-y-3">
        {items.map((it) => (
          <label key={it.k} className="flex items-start gap-3 neu-soft rounded-2xl p-4">
            <input type="checkbox" className="mt-1 h-4 w-4" disabled={!isAdmin} checked={!!ch[it.k]} onChange={(e) => setCh({ ...ch, [it.k]: e.target.checked })} />
            <span className="flex-1"><span className="flex items-center gap-2 font-bold">{it.label} {it.status}</span><span className="text-sm text-ink-3">{it.note}</span></span>
          </label>
        ))}
        <Field label="UnWay site address" hint="Where this website is hosted, e.g. https://unway.pages.dev. Parent pages, live tracking links and invites use it.">
          <Input disabled={!isAdmin} value={track} onChange={(e) => setTrack(e.target.value)} placeholder="https://…" />
        </Field>
        {isAdmin && <Button size="sm" onClick={setupBot}>Connect Telegram bot (set webhook)</Button>}
      </div>
    </Panel>
  );
}

function StaffAlertsPanel() {
  const { org } = useAuth();
  const s = useSettings();
  const cfg = usePublicConfig();
  const link = cfg.data?.telegram_bot ? `https://t.me/${cfg.data.telegram_bot}?start=staff_${org?.staff_join_code}` : null;
  return (
    <Panel title="SOS alerts to staff phones">
      <p className="text-ink-2">Staff who should get SOS and safety alerts on Telegram open this link on their phone and tap <b>Start</b>. Works for groups too: add the bot to a staff group and send <code className="rounded bg-surface px-1">/staff {org?.staff_join_code}</code>.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {link ? <><code className="rounded bg-surface px-2 py-1 text-sm">{link}</code><Button size="sm" onClick={() => copy(link, "Staff link copied")}>Copy</Button></> : <Badge tone="warn">Set up the Telegram bot first</Badge>}
        <span className="text-sm text-ink-3">{s.staff_telegram_chat_ids.length} chat(s) connected</span>
      </div>
    </Panel>
  );
}

function UsersPanel() {
  const { isAdmin, member } = useAuth();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["org-users"], queryFn: async () => check(await supabase.from("org_users").select("*").order("created_at")) as OrgUser[] });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("transport_manager");
  async function invite() {
    try { await adminTool({ action: "invite_user", email, role, redirect_to: window.location.origin }); toast.success("Invitation sent"); setEmail(""); qc.invalidateQueries({ queryKey: ["org-users"] }); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function changeRole(u: OrgUser, r: string) {
    const { error } = await supabase.from("org_users").update({ role: r }).eq("user_id", u.user_id);
    if (error) toast.error(error.message); else qc.invalidateQueries({ queryKey: ["org-users"] });
  }
  async function remove(u: OrgUser) {
    if (!confirm(`Remove ${u.email}?`)) return;
    const { error } = await supabase.from("org_users").delete().eq("user_id", u.user_id);
    if (error) toast.error(error.message); else qc.invalidateQueries({ queryKey: ["org-users"] });
  }
  const ROLES = { school_admin: "School admin", transport_manager: "Transport manager", viewer: "Viewer (principal)" };
  return (
    <Panel title="People with access" padded={false}>
      <Table head={["Name", "Email", "Role", ""]}>
        {(users.data ?? []).map((u) => (
          <tr key={u.user_id}><Td className="font-semibold">{u.name ?? "–"}</Td><Td>{u.email}</Td>
            <Td>{isAdmin && u.user_id !== member?.user_id ? <Select className="h-8 w-52" value={u.role} onChange={(e) => changeRole(u, e.target.value)}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select> : ROLES[u.role]}</Td>
            <Td className="text-right">{isAdmin && u.user_id !== member?.user_id && <Button size="sm" variant="ghost" onClick={() => remove(u)}>Remove</Button>}</Td></tr>
        ))}
      </Table>
      {isAdmin && (
        <div className="flex flex-wrap items-end gap-2 p-5">
          <Field label="Invite by email" className="min-w-64 flex-1"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Button variant="primary" disabled={!email.includes("@")} onClick={invite}>Send invite</Button>
        </div>
      )}
    </Panel>
  );
}

function AutomationSettings() {
  const { isAdmin } = useAuth();
  const s = useSettings();
  const save = useSaveSettings();
  const [f, setF] = useState({ approaching_m: s.approaching_m, escalate_after_min: s.escalate_after_min, approaching_whatsapp: s.approaching_whatsapp });
  useEffect(() => setF({ approaching_m: s.approaching_m, escalate_after_min: s.escalate_after_min, approaching_whatsapp: s.approaching_whatsapp }), [s.approaching_m, s.escalate_after_min, s.approaching_whatsapp]);
  return (
    <Panel title="Automation" actions={isAdmin && <Button variant="primary" size="sm" onClick={() => save(f)}>Save</Button>}>
      <p className="mb-4 text-sm text-ink-3">Switch automations on or off from the Home page. Fine-tune them here.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label='“Bus is coming” alert distance' hint="Parents at the next stop are told when the bus is this close.">
          <Select disabled={!isAdmin} value={f.approaching_m} onChange={(e) => setF({ ...f, approaching_m: Number(e.target.value) })}>
            {[600, 900, 1200, 1800, 2500].map((m) => <option key={m} value={m}>{(m / 1000).toFixed(1)} km (about {Math.round(m * 1.3 / 1000 / 20 * 60)} min)</option>)}
          </Select>
        </Field>
        <Field label="Re-alert staff if an alert is open for" hint="High and critical alerts only. SOS is always re-sent after 3 minutes.">
          <Select disabled={!isAdmin} value={f.escalate_after_min} onChange={(e) => setF({ ...f, escalate_after_min: Number(e.target.value) })}>
            {[3, 5, 10, 15].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </Select>
        </Field>
        <Field label='Send “bus is coming” on WhatsApp too' hint="Costs one WhatsApp message per child per trip. Telegram and browser alerts are free.">
          <Select disabled={!isAdmin} value={f.approaching_whatsapp ? "yes" : "no"} onChange={(e) => setF({ ...f, approaching_whatsapp: e.target.value === "yes" })}>
            <option value="no">No, free channels only</option><option value="yes">Yes</option>
          </Select>
        </Field>
      </div>
    </Panel>
  );
}
