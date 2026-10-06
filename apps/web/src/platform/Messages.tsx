import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { rpc } from "../lib/supabase";
import { fmtDateTime } from "../lib/format";
import { Badge, Button, Empty, Loading, PageHeader, Panel, Table, Tabs, Td } from "../components/ui";
import type { MessageRow } from "./types";

const HINTS: [RegExp, string][] = [
  [/TELEGRAM_BOT_TOKEN/, "Set the TELEGRAM_BOT_TOKEN secret in Supabase."],
  [/WhatsApp env/, "WhatsApp isn't set up (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)."],
  [/blocked|chat not found|deactivated/i, "The parent blocked the bot or deleted the chat."],
  [/132001|template/i, "WhatsApp template missing or not approved."],
  [/131047/, "24-hour window closed; needs an approved template."],
  [/410|expired|unsubscribed/i, "Browser alert subscription expired."],
];

export default function Messages() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"failed" | "queued" | "all">("failed");
  const q = useQuery({ queryKey: ["platform-messages", tab], queryFn: () => rpc<MessageRow[]>("platform_messages", { p_status: tab, p_limit: 200 }), refetchInterval: 30_000 });
  async function retry() {
    try { const n = await rpc<number>("platform_retry_failed"); toast.success(n ? `${n} messages queued again` : "Nothing to retry"); qc.invalidateQueries({ queryKey: ["platform-messages"] }); qc.invalidateQueries({ queryKey: ["platform-overview"] }); }
    catch (e) { toast.error((e as Error).message); }
  }
  const hint = (err: string | null) => HINTS.find(([re]) => err && re.test(err))?.[1];
  return (
    <div>
      <PageHeader eyebrow="UnWay console" title="Parent messages" sub="Every message goes through one outbox that retries on its own. Anything that keeps failing shows up here."
        actions={<Button onClick={retry}><RotateCcw size={16} /> Retry failed (last 24 h)</Button>} />
      <div className="mb-3"><Tabs value={tab} onChange={setTab} items={[{ value: "failed", label: "Failed" }, { value: "queued", label: "Waiting" }, { value: "all", label: "All recent" }]} /></div>
      <Panel padded={false}>
        {q.isLoading ? <Loading /> : !q.data?.length ? <Empty title={tab === "failed" ? "No failed messages" : "Nothing here"}>{tab === "failed" ? "Every parent message got through." : ""}</Empty> : (
          <Table head={["When", "School", "Event", "Channel", "Status", "Problem"]}>
            {q.data.map((m) => (
              <tr key={m.id}>
                <Td className="whitespace-nowrap text-ink-3">{fmtDateTime(m.created_at)}</Td>
                <Td className="font-semibold">{m.school ?? "–"}</Td>
                <Td><code className="text-xs">{m.event}</code></Td>
                <Td>{m.channel}</Td>
                <Td><Badge tone={m.status === "failed" ? "alert" : m.status === "queued" || m.status === "sending" ? "warn" : "safe"}>{m.status}</Badge>{m.attempts > 1 && <span className="ml-1 text-xs text-ink-3">×{m.attempts}</span>}</Td>
                <Td className="max-w-md text-sm">{m.error ? <><span className="text-ink-2">{hint(m.error) ?? ""}</span><span className="block truncate text-xs text-ink-3" title={m.error}>{m.error}</span></> : "–"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
