import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, MessageCircle, Plus, Send, Trash2 } from "lucide-react";
import { useAuth, useSettings } from "../lib/auth";
import { check, rpc, supabase, friendlyError } from "../lib/supabase";
import type { Guardian, GuardianChannel } from "../lib/types";
import { joinLink, telegramLink, trackBase, usePublicConfig } from "../lib/config";
import { Badge, Button, Field, Input, Modal, Select } from "./ui";

const CH_LABEL: Record<string, string> = { whatsapp: "WhatsApp", telegram: "Telegram", webpush: "Browser alerts", email: "Email" };

export function ChannelBadges({ channels }: { channels: GuardianChannel[] }) {
  if (!channels.length) return <Badge tone="warn">No channel yet</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      {channels.map((c) => (
        <Badge key={c.id} tone={c.status === "active" ? "safe" : c.status === "stopped" ? "muted" : "alert"}>
          {CH_LABEL[c.channel]}{c.status !== "active" ? ` (${c.status})` : ""}
        </Badge>
      ))}
    </span>
  );
}

export function copy(text: string, label = "Copied") {
  navigator.clipboard.writeText(text).then(() => toast.success(label), () => toast.error("Couldn't copy"));
}

/** Guardians linked to one student, with channel management. */
export function StudentGuardians({ studentId }: { studentId: string }) {
  const { org, canWrite } = useAuth();
  const settings = useSettings();
  const cfg = usePublicConfig();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const q = useQuery({
    queryKey: ["student-guardians", studentId],
    queryFn: async () => {
      const links = check(await supabase.from("student_guardians").select("guardian_id,is_primary,notify").eq("student_id", studentId)) as { guardian_id: string; is_primary: boolean; notify: boolean }[];
      const ids = links.map((l) => l.guardian_id);
      if (!ids.length) return [];
      const [gs, chs] = await Promise.all([
        supabase.from(canWrite ? "guardians" : "guardians_masked").select("*").in("id", ids),
        canWrite ? supabase.from("guardian_channels").select("*").in("guardian_id", ids) : Promise.resolve({ data: [], error: null }),
      ]);
      return links.map((l) => ({
        ...l,
        guardian: (gs.data as Guardian[]).find((g) => g.id === l.guardian_id)!,
        channels: ((chs.data ?? []) as GuardianChannel[]).filter((c) => c.guardian_id === l.guardian_id),
      })).filter((x) => x.guardian);
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["student-guardians", studentId] }); qc.invalidateQueries({ queryKey: ["active-channels"] }); qc.invalidateQueries({ queryKey: ["parents"] }); };
  const base = trackBase(cfg.data, settings.track_base_url);

  async function enableWhatsapp(g: Guardian) {
    if (!g.phone) return toast.error("Add a phone number first");
    if (!confirm(`Confirm that ${g.name} agreed to receive WhatsApp bus updates on ${g.phone}.`)) return;
    const { error } = await supabase.from("guardian_channels").insert({ org_id: org!.id, guardian_id: g.id, channel: "whatsapp", address: g.phone.replace(/\D/g, ""), status: "active", verified_at: new Date().toISOString() });
    if (error) return toast.error(friendlyError(error.message));
    await supabase.from("consents").insert({ org_id: org!.id, guardian_id: g.id, channel: "whatsapp" });
    toast.success("WhatsApp enabled"); refresh();
  }
  async function sendOptin(g: Guardian) {
    try { await rpc("send_optin", { p_guardian_ids: [g.id] }); toast.success("Welcome message queued"); } catch (e) { toast.error((e as Error).message); }
  }
  async function removeChannel(c: GuardianChannel) {
    if (!confirm(`Stop ${CH_LABEL[c.channel]} updates for this guardian?`)) return;
    const { error } = await supabase.from("guardian_channels").delete().eq("id", c.id);
    if (error) toast.error(error.message); else refresh();
  }
  async function unlink(gid: string) {
    if (!confirm("Remove this guardian from the student?")) return;
    const { error } = await supabase.from("student_guardians").delete().eq("student_id", studentId).eq("guardian_id", gid);
    if (error) toast.error(error.message); else refresh();
  }
  async function toggleNotify(gid: string, notify: boolean) {
    await supabase.from("student_guardians").update({ notify }).eq("student_id", studentId).eq("guardian_id", gid);
    refresh();
  }

  return (
    <div className="space-y-3">
      {(q.data ?? []).map(({ guardian: g, channels, notify, is_primary }) => {
        const tg = telegramLink(cfg.data?.telegram_bot, g.invite_code ?? "");
        const join = joinLink(base, g.invite_code ?? "");
        return (
          <div key={g.id} className="neu-soft rounded-2xl p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-bold">{g.name} {is_primary && <Badge tone="route">Primary</Badge>}</div>
                <div className="text-sm text-ink-3">{g.relation ?? "Guardian"} · {g.phone ?? "no phone"} · {{ en: "English", hi: "Hindi", te: "Telugu" }[g.language]}</div>
              </div>
              {canWrite && <button onClick={() => unlink(g.id)} className="text-ink-3 hover:text-alert" aria-label="Remove guardian"><Trash2 size={16} /></button>}
            </div>
            <div className="mt-2"><ChannelBadges channels={channels} /></div>
            {canWrite && (
              <div className="mt-3 flex flex-wrap gap-2">
                {tg && <Button size="sm" onClick={() => copy(tg, "Telegram invite link copied")}><Send size={14} /> Copy Telegram link</Button>}
                {join && <Button size="sm" onClick={() => copy(join, "Invite page link copied")}><Copy size={14} /> Copy invite page</Button>}
                {!channels.some((c) => c.channel === "whatsapp") && g.phone && <Button size="sm" onClick={() => enableWhatsapp(g)}><MessageCircle size={14} /> Enable WhatsApp</Button>}
                {channels.some((c) => c.channel === "whatsapp") && settings.channels.whatsapp && <Button size="sm" onClick={() => sendOptin(g)}>Send WhatsApp welcome</Button>}
                {channels.map((c) => <Button key={c.id} size="sm" variant="ghost" onClick={() => removeChannel(c)}>Remove {CH_LABEL[c.channel]}</Button>)}
                <label className="ml-auto flex items-center gap-1.5 text-sm"><input type="checkbox" checked={notify} onChange={(e) => toggleNotify(g.id, e.target.checked)} /> Gets alerts</label>
              </div>
            )}
          </div>
        );
      })}
      {q.data?.length === 0 && <p className="text-ink-3">No guardians yet. Parents need at least one guardian to get updates.</p>}
      {canWrite && <Button size="sm" onClick={() => setAdding(true)}><Plus size={15} /> Add guardian</Button>}
      <AddGuardian open={adding} onClose={() => setAdding(false)} studentId={studentId} onDone={refresh} />
    </div>
  );
}

function AddGuardian({ open, onClose, studentId, onDone }: { open: boolean; onClose: () => void; studentId: string; onDone: () => void }) {
  const { org } = useAuth();
  const [f, setF] = useState({ name: "", phone: "", relation: "Father", language: "en", email: "" });
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      let phone = f.phone.replace(/[^\d+]/g, "");
      if (phone && !phone.startsWith("+")) phone = phone.length === 10 ? "+91" + phone : "+" + phone;
      let gid: string | undefined;
      if (phone) gid = (await supabase.from("guardians").select("id").eq("phone", phone).maybeSingle()).data?.id;
      if (!gid) {
        const { data, error } = await supabase.from("guardians").insert({ org_id: org!.id, name: f.name.trim(), phone: phone || null, relation: f.relation, language: f.language, email: f.email || null }).select("id").single();
        if (error) throw error;
        gid = data.id;
      }
      const { error } = await supabase.from("student_guardians").insert({ org_id: org!.id, student_id: studentId, guardian_id: gid });
      if (error) throw error;
      toast.success("Guardian added"); onDone(); onClose();
      setF({ name: "", phone: "", relation: "Father", language: "en", email: "" });
    } catch (err) { toast.error(friendlyError((err as Error).message)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add guardian"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" form="g-form" disabled={busy}>Add guardian</Button></>}>
      <form id="g-form" onSubmit={save} className="grid gap-3">
        <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mobile" hint="Existing guardians with the same number are reused (siblings)."><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Relation"><Select value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })}>{["Mother", "Father", "Guardian", "Grandparent", "Other"].map((r) => <option key={r}>{r}</option>)}</Select></Field>
          <Field label="Language"><Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="en">English</option><option value="hi">Hindi</option><option value="te">Telugu</option></Select></Field>
        </div>
        <Field label="Email (optional)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}
