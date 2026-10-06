import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Clock3 } from "lucide-react";
import { rpc } from "../lib/supabase";
import { ago } from "../lib/format";
import { Badge, Loading, Notice, PageHeader, Panel, Table, Td } from "../components/ui";
import { Meter } from "../components/Charts";
import { mb, type HealthInfo } from "./types";

const JOB_LABEL: Record<string, string> = {
  "unway-minutely": "Every minute: late trips, offline phones, escalations",
  "unway-dispatch-retry": "Every 30 s: send and retry parent messages",
  "unway-daily": "Midnight: create trips, learn stop times, clean up",
  "unway-evening": "6 pm: evening summary to school staff",
};

export default function Health() {
  const h = useQuery({ queryKey: ["platform-health"], queryFn: () => rpc<HealthInfo>("platform_health"), refetchInterval: 30_000 });
  if (h.isLoading || !h.data) return <Loading />;
  const d = h.data;
  const failing = d.jobs.filter((j) => j.last_status && j.last_status !== "succeeded");
  const stale = d.oldest_queued && Date.now() - new Date(d.oldest_queued).getTime() > 10 * 60_000;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="UnWay console" title="System health" sub="Background jobs, message sending and free-tier limits." />
      <div className="grid gap-3 md:grid-cols-3">
        {failing.length ? <Notice tone="alert" icon={CircleAlert} title={`${failing.length} background job${failing.length > 1 ? "s" : ""} failing`} />
          : <Notice tone="safe" icon={CheckCircle2} title="Background jobs running" />}
        {d.dispatch_wired ? <Notice tone="safe" icon={CheckCircle2} title="Instant message sending is wired" />
          : <Notice tone="warn" icon={CircleAlert} title="Instant sending not wired">Messages still go out every 30 s. Add the Vault secrets (docs/SETUP.md).</Notice>}
        {stale ? <Notice tone="warn" icon={Clock3} title="Messages are waiting too long">Oldest queued {ago(d.oldest_queued)}.</Notice>
          : <Notice tone="safe" icon={CheckCircle2} title="Message queue is moving" />}
      </div>
      <Panel title="Background jobs" padded={false}>
        <Table head={["Job", "Schedule", "Last run", "Result"]}>
          {d.jobs.map((j) => (
            <tr key={j.job}>
              <Td><span className="font-semibold">{JOB_LABEL[j.job] ?? j.job}</span><span className="block text-xs text-ink-3">{j.job}</span></Td>
              <Td><code className="text-xs">{j.schedule}</code></Td>
              <Td className="text-ink-3">{ago(j.last_run)}</Td>
              <Td>{j.last_status === "succeeded" ? <Badge tone="safe">OK</Badge> : j.last_status ? <Badge tone="alert" >{j.last_status}</Badge> : <Badge tone="muted">Not run yet</Badge>}
                {j.last_status && j.last_status !== "succeeded" && j.message && <span className="block max-w-sm truncate text-xs text-alert" title={j.message}>{j.message}</span>}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel title="Database (Supabase free tier)">
        <Meter value={Math.round(d.db_bytes / 1024 / 1024)} max={Math.round(d.db_limit_bytes / 1024 / 1024)} tone={d.db_bytes > d.db_limit_bytes * 0.8 ? "alert" : "safe"} label="MB used" />
        <ul className="mt-4 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          {d.tables.slice(0, 10).map((t) => <li key={t.table} className="flex justify-between border-b border-line-2 py-1"><span>{t.table}</span><span className="tabular text-ink-3">{mb(t.bytes)}</span></li>)}
        </ul>
      </Panel>
    </div>
  );
}
