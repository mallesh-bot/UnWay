import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { toast } from "sonner";
import { Link2, MessageCircle, Printer } from "lucide-react";
import { useAuth, useSettings } from "../lib/auth";
import { check, rpc, supabase } from "../lib/supabase";
import type { Guardian, GuardianChannel } from "../lib/types";
import { joinLink, telegramLink, trackBase, usePublicConfig } from "../lib/config";
import { qrDataUrl } from "../lib/qr";
import { Button, Empty, Input, Kpi, Loading, PageHeader, Panel, Select, Table, Td } from "../components/ui";
import { ChannelBadges, copy } from "../components/Guardians";

interface Row { guardian: Guardian; channels: GuardianChannel[]; children: { id: string; first_name: string; last_name: string }[] }

export default function Parents() {
  const { org, canWrite } = useAuth();
  const settings = useSettings();
  const cfg = usePublicConfig();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);

  const data = useQuery({
    queryKey: ["parents"],
    enabled: canWrite,
    queryFn: async () => {
      const [g, c, l] = await Promise.all([
        supabase.from("guardians").select("*").order("name"),
        supabase.from("guardian_channels").select("*"),
        supabase.from("student_guardians").select("guardian_id, students(id,first_name,last_name)"),
      ]);
      const gs = check(g) as Guardian[];
      const chs = check(c) as GuardianChannel[];
      const links = check(l) as unknown as { guardian_id: string; students: Row["children"][number] }[];
      return gs.map((guardian) => ({
        guardian,
        channels: chs.filter((x) => x.guardian_id === guardian.id),
        children: links.filter((x) => x.guardian_id === guardian.id).map((x) => x.students).filter(Boolean),
      })) as Row[];
    },
  });

  const rows = useMemo(() => (data.data ?? []).filter((r) => {
    const connected = r.channels.some((c) => c.status === "active");
    if (filter === "connected" && !connected) return false;
    if (filter === "not" && connected) return false;
    if (q && !`${r.guardian.name} ${r.guardian.phone ?? ""} ${r.children.map((c) => c.first_name).join(" ")}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [data.data, q, filter]);

  const total = data.data?.length ?? 0;
  const connected = (data.data ?? []).filter((r) => r.channels.some((c) => c.status === "active")).length;
  const base = trackBase(cfg.data, settings.track_base_url);

  async function printSlips() {
    const target = rows.filter((r) => !r.channels.some((c) => c.status === "active"));
    const list = target.length ? target : rows;
    if (!list.length) return;
    if (!base && !cfg.data?.telegram_bot) { toast.error("Set the parent site address in Settings first (or deploy the Telegram bot)."); return; }
    setBusy(true);
    try {
      const doc = await PDFDocument.create();
      const bold = await doc.embedFont(StandardFonts.HelveticaBold);
      const reg = await doc.embedFont(StandardFonts.Helvetica);
      const MM = 72 / 25.4, W = 210 * MM, H = 297 * MM, sw = 95 * MM, sh = 66 * MM;
      const ink = rgb(0.118, 0.165, 0.196);
      let page = doc.addPage([W, H]);
      for (let i = 0; i < list.length; i++) {
        if (i > 0 && i % 8 === 0) page = doc.addPage([W, H]);
        const slot = i % 8, col = slot % 2, row = Math.floor(slot / 2);
        const x = 10 * MM + col * (sw + 0 * MM), y = H - 10 * MM - (row + 1) * sh;
        const r = list[i];
        const url = joinLink(base, r.guardian.invite_code) ?? telegramLink(cfg.data?.telegram_bot, r.guardian.invite_code)!;
        page.drawRectangle({ x, y, width: sw, height: sh, borderColor: rgb(0.7, 0.75, 0.78), borderWidth: 0.6, borderDashArray: [3, 3] });
        page.drawRectangle({ x, y: y + sh - 9 * MM, width: sw, height: 9 * MM, color: rgb(0.949, 0.718, 0.02) });
        const clean = (t: string) => t.replace(/[^\x20-\x7E]/g, "");
        page.drawText(clean(org!.name).slice(0, 48), { x: x + 4 * MM, y: y + sh - 6 * MM, size: 10, font: bold, color: ink });
        page.drawText("Get school bus updates on your phone", { x: x + 4 * MM, y: y + sh - 16 * MM, size: 10, font: bold, color: ink });
        page.drawText(clean(`For: ${r.children.map((c) => c.first_name).join(", ")}`).slice(0, 40), { x: x + 4 * MM, y: y + sh - 22 * MM, size: 9, font: reg, color: ink });
        const lines = ["1. Scan this code with your phone camera", "2. Your child's bus page opens. Turn on", "   Telegram or browser alerts there.", "3. Get a message when your child boards", "   and gets off the bus. Free, no app."];
        lines.forEach((t, j) => page.drawText(t, { x: x + 4 * MM, y: y + sh - (29 + j * 5) * MM, size: 7.5, font: reg, color: ink }));
        const qr = await doc.embedPng(Uint8Array.from(atob((await qrDataUrl(url, 360)).split(",")[1]), (ch) => ch.charCodeAt(0)));
        page.drawImage(qr, { x: x + sw - 36 * MM, y: y + 4 * MM, width: 32 * MM, height: 32 * MM });
        page.drawText(`Code ${r.guardian.invite_code}`, { x: x + sw - 36 * MM, y: y + 1.5 * MM, size: 6.5, font: reg, color: ink });
      }
      const bytes = await doc.save();
      window.open(URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })), "_blank");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  const qc = useQueryClient();
  async function inviteAll() {
    try {
      const n = await rpc<number>("invite_all_whatsapp");
      toast.success(n ? `WhatsApp invites queued for ${n} parents` : "Everyone with a phone number already has a WhatsApp invite");
      qc.invalidateQueries({ queryKey: ["parents"] });
    } catch (e) { toast.error((e as Error).message); }
  }

  if (!canWrite) return <Panel><Empty title="Parent contacts are restricted">Only admins and transport managers can see parent phone numbers.</Empty></Panel>;

  return (
    <div>
      <PageHeader title="Parents" sub="Parents connect for free with Telegram or browser alerts, or get WhatsApp messages once enabled."
        actions={<>
          {settings.channels.whatsapp && <Button onClick={inviteAll}><MessageCircle size={16} /> Invite all on WhatsApp</Button>}
          <Button variant="primary" disabled={busy} onClick={printSlips}><Printer size={16} /> Print invite slips</Button>
        </>} />
      <div className="mb-5 grid grid-cols-3 gap-6 neu rounded-[22px] px-6 py-5 shadow-card sm:max-w-xl">
        <Kpi label="Guardians" value={total} />
        <Kpi label="Connected" value={connected} tone="safe" />
        <Kpi label="Not connected" value={total - connected} tone={total - connected ? "warn" : undefined} />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search parent, phone or child" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-52" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Everyone</option><option value="connected">Connected</option><option value="not">Not connected</option>
        </Select>
      </div>
      <Panel padded={false}>
        {data.isLoading ? <Loading /> : rows.length === 0 ? <Empty title="No parents found">Parents are added with students.</Empty> : (
          <Table head={["Guardian", "Children", "Phone", "Channels", "Links"]}>
            {rows.map((r) => {
              const link = joinLink(base, r.guardian.invite_code) ?? telegramLink(cfg.data?.telegram_bot, r.guardian.invite_code);
              return (
                <tr key={r.guardian.id}>
                  <Td><span className="font-semibold">{r.guardian.name}</span><span className="block text-xs text-ink-3">{r.guardian.relation}</span></Td>
                  <Td>{r.children.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link className="hover:underline" to={`/students/${c.id}`}>{c.first_name}</Link></span>)}</Td>
                  <Td className="tabular">{r.guardian.phone ?? "–"}</Td>
                  <Td><ChannelBadges channels={r.channels} /></Td>
                  <Td className="whitespace-nowrap">
                    {r.guardian.portal_token && <Button size="sm" variant="ghost" title="The parent's own page: today's status, history, absences" onClick={() => copy(`${base}/p/${r.guardian.portal_token}`, "Parent page link copied")}><Link2 size={14} /> Parent page</Button>}
                    {link && <Button size="sm" variant="ghost" onClick={() => copy(link, "Invite link copied")}>Invite</Button>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>
    </div>
  );
}
