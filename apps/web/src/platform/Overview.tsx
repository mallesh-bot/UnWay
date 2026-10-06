import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Building2, Bus, Database, IndianRupee, MessageSquareWarning, ScanLine, Siren, Smartphone, Users } from "lucide-react";
import { rpc } from "../lib/supabase";
import { ago } from "../lib/format";
import { Badge, Notice, PageHeader, Panel, Stat, Table, Tabs, Td } from "../components/ui";
import { BarChart, Meter } from "../components/Charts";
import { mb, WHATSAPP_RATE_INR, type Overview as OV, type SchoolRow } from "./types";

export default function Overview() {
  const ov = useQuery({ queryKey: ["platform-overview"], queryFn: () => rpc<OV>("platform_overview"), refetchInterval: 30_000 });
  const schools = useQuery({ queryKey: ["platform-schools"], queryFn: () => rpc<SchoolRow[]>("platform_schools") });
  const [chart, setChart] = useState<"scans" | "messages">("scans");
  const o = ov.data;
  if (!o) return null;
  const label = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const msgTotal = Object.values(o.messages_24h).reduce((a, b) => a + b, 0);
  const watch = (schools.data ?? []).filter((s) => s.status === "trial" || s.open_exceptions > 0 || (s.devices < s.buses))
    .sort((a, b) => b.open_exceptions - a.open_exceptions).slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="UnWay console" title="Across all schools" sub={`${o.schools} schools · ${o.students.toLocaleString("en-IN")} students riding with UnWay`} />

      {(o.open_sos > 0 || o.failed_24h > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {o.open_sos > 0 && <Notice tone="alert" icon={Siren} title={`${o.open_sos} SOS open across schools`}>Check that each school's team has seen it.</Notice>}
          {o.failed_24h > 0 && <Notice tone="warn" icon={MessageSquareWarning} title={`${o.failed_24h} parent messages failed in the last 24 h`}
            action={<Link to="/platform/messages" className="text-sm font-bold text-route">Review</Link>}>Usually a missing bot token, an expired WhatsApp template or a parent who blocked the bot.</Notice>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat icon={Building2} label="Schools" value={o.schools} hint={`${o.schools_active} active · ${o.schools_trial} trial`} tone="bus" to="/platform/schools" />
        <Stat icon={Users} label="Students" value={o.students.toLocaleString("en-IN")} hint={`${o.guardians.toLocaleString("en-IN")} parents`} />
        <Stat icon={BellRing} label="Parents connected" value={`${o.guardians ? Math.round((100 * o.guardians_connected) / o.guardians) : 0}%`} hint={`${o.guardians_connected} of ${o.guardians}`} tone="safe" />
        <Stat icon={Bus} label="Trips today" value={o.trips_today} hint={`${o.trips_active} running now`} tone="route" />
        <Stat icon={ScanLine} label="Scans today" value={o.scans_today.toLocaleString("en-IN")} />
        <Stat icon={Smartphone} label="Bus phones online" value={`${o.devices_seen_1h}/${o.devices_paired}`} hint="seen in the last hour" tone={o.devices_paired && o.devices_seen_1h < o.devices_paired / 2 ? "warn" : "ink"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Panel title="Last 14 days" actions={<Tabs value={chart} onChange={setChart} items={[{ value: "scans", label: "Boarding scans" }, { value: "messages", label: "Parent messages" }]} />}>
          {chart === "scans"
            ? <BarChart data={o.daily.map((d) => ({ label: label(d.day), value: d.scans }))} fmt={(v) => `${v} scans`} />
            : <BarChart data={o.daily.map((d) => ({ label: label(d.day), value: d.messages }))} color="#1F8A5B" fmt={(v) => `${v} messages`} />}
        </Panel>
        <div className="space-y-6">
          <Panel title="Messages sent, last 24 h">
            {msgTotal === 0 ? <p className="text-ink-3">No messages in the last 24 hours.</p> : (
              <div className="space-y-3">
                {Object.entries(o.messages_24h).sort((a, b) => b[1] - a[1]).map(([ch, n]) => (
                  <Meter key={ch} value={n} max={msgTotal} label={{ telegram: "Telegram", whatsapp: "WhatsApp", webpush: "Browser alerts", email: "Email" }[ch] ?? ch} tone={ch === "whatsapp" ? "warn" : "route"} />
                ))}
              </div>
            )}
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-surface p-3">
              <IndianRupee size={18} className="text-ink-3" />
              <div className="text-sm"><b className="tabular">₹{(o.whatsapp_30d * WHATSAPP_RATE_INR).toFixed(0)}</b> WhatsApp spend in 30 days <span className="text-ink-3">({o.whatsapp_30d} messages at about ₹{WHATSAPP_RATE_INR})</span></div>
            </div>
          </Panel>
          <Panel title={<span className="flex items-center gap-2"><Database size={16} /> Free-tier usage</span>}>
            <Meter value={Math.round(o.db_bytes / 1024 / 1024)} max={500} tone={o.db_bytes > 400 * 1024 * 1024 ? "alert" : "safe"} label="Database (MB of 500)" />
            <p className="mt-2 text-sm text-ink-3">{mb(o.db_bytes)} used. Old GPS points are cleaned up after 90 days automatically. {o.outbox_queued} messages waiting to send.</p>
          </Panel>
        </div>
      </div>

      <Panel title="Schools to keep an eye on" actions={<Link to="/platform/schools" className="text-sm font-semibold text-route">All schools</Link>} padded={false}>
        {watch.length === 0 ? <p className="px-5 py-6 text-ink-3">All schools look healthy.</p> : (
          <Table head={["School", "Status", "Parents connected", "Bus phones", "Open alerts", "Last activity"]}>
            {watch.map((s) => (
              <tr key={s.id}>
                <Td><Link to={`/platform/schools?open=${s.id}`} className="font-semibold hover:underline">{s.name}</Link> <span className="text-xs text-ink-3">{s.short_code}</span></Td>
                <Td><StatusBadge status={s.status} /></Td>
                <Td className="tabular">{s.connected}/{s.guardians}</Td>
                <Td className="tabular">{s.devices}/{s.buses}</Td>
                <Td>{s.open_exceptions ? <Badge tone="alert">{s.open_exceptions}</Badge> : "0"}</Td>
                <Td className="text-ink-3">{ago(s.last_activity)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return status === "active" ? <Badge tone="safe">Active</Badge> : status === "trial" ? <Badge tone="warn">Trial</Badge> : <Badge tone="alert">Paused</Badge>;
}
