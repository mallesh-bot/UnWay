import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { rpc } from "../lib/supabase";
import { addDays, downloadCsv, EXCEPTION_LABEL, fmtDate, fmtTime, STATE_LABEL, todayISO } from "../lib/format";
import type { CustodyState } from "../lib/types";
import { Button, Empty, ErrorBox, Input, Loading, PageHeader, Panel, Table, Td, cx } from "../components/ui";

type Row = Record<string, unknown>;
const REPORTS = [
  { key: "attendance", label: "Daily attendance", fn: "report_daily_attendance", single: true },
  { key: "trips", label: "Trip performance", fn: "report_trip_performance" },
  { key: "compliance", label: "Scan compliance", fn: "report_scan_compliance" },
  { key: "exceptions", label: "Exceptions", fn: "report_exceptions_summary" },
  { key: "safety", label: "Safety", fn: "report_safety" },
  { key: "notifications", label: "Parent messages", fn: "report_notifications" },
] as const;

export default function Reports() {
  const [tab, setTab] = useState<(typeof REPORTS)[number]["key"]>("attendance");
  const [from, setFrom] = useState(addDays(todayISO(), -6));
  const [to, setTo] = useState(todayISO());
  const rep = REPORTS.find((r) => r.key === tab)!;
  const q = useQuery({
    queryKey: ["report", tab, from, to],
    queryFn: () => rpc<Row[]>(rep.fn, "single" in rep ? { p_date: to } : { p_from: from, p_to: to }),
  });
  const rows = q.data ?? [];

  return (
    <div>
      <PageHeader title="Reports" actions={<>
        {!("single" in rep) && <Input type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} />}
        <Input type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button disabled={!rows.length} onClick={() => downloadCsv(`unway-${tab}-${from}-${to}.csv`, rows)}><Download size={16} /> Export CSV</Button>
      </>} />
      <div className="neu-inset mb-5 flex flex-wrap gap-1 rounded-2xl p-1.5">
        {REPORTS.map((r) => <button key={r.key} onClick={() => setTab(r.key)} className={cx("rounded-xl px-3 py-1.5 font-semibold transition-all duration-300", tab === r.key ? "bg-panel text-ink shadow-[3px_3px_8px_var(--neu-dark),-3px_-3px_8px_var(--neu-light)]" : "text-ink-3 hover:text-ink")}>{r.label}</button>)}
      </div>
      <ErrorBox error={q.error} />
      <Panel padded={false}>
        {q.isLoading ? <Loading /> : rows.length === 0 ? <Empty title="No data for this period" /> : <ReportTable tab={tab} rows={rows} />}
      </Panel>
    </div>
  );
}

function st(v: unknown) { return v ? STATE_LABEL[v as CustodyState] ?? String(v) : "–"; }

function ReportTable({ tab, rows }: { tab: string; rows: Row[] }) {
  if (tab === "attendance") return (
    <Table head={["Student", "Class", "Morning", "Boarded", "At school", "Afternoon", "Boarded", "Dropped"]}>
      {rows.map((r) => (
        <tr key={String(r.student_id)}>
          <Td className="font-semibold">{String(r.name)}</Td><Td>{String(r.class || "–")}</Td>
          <Td className={r.am_state === "MISSED" ? "font-bold text-alert" : ""}>{st(r.am_state)}</Td><Td className="tabular">{fmtTime(r.am_board as string)}</Td><Td className="tabular">{fmtTime(r.am_drop as string)}</Td>
          <Td className={r.pm_state === "MISSED" || r.pm_state === "UNCONFIRMED" ? "font-bold text-alert" : ""}>{st(r.pm_state)}</Td><Td className="tabular">{fmtTime(r.pm_board as string)}</Td><Td className="tabular">{fmtTime(r.pm_drop as string)}</Td>
        </tr>
      ))}
    </Table>
  );
  if (tab === "trips") return (
    <Table head={["Date", "Route", "Bus", "Status", "Scheduled", "Start delay", "Duration", "Riders", "Scanned on", "Scanned off", "Manual", "Exceptions", "Empty bus check"]}>
      {rows.map((r) => (
        <tr key={String(r.trip_id)}>
          <Td>{fmtDate(r.trip_date as string)}</Td><Td className="font-semibold">{String(r.route)} {r.direction === "MORNING" ? "AM" : "PM"}</Td><Td>{String(r.bus ?? "–")}</Td><Td>{String(r.status)}</Td>
          <Td className="tabular">{fmtTime(r.scheduled_start as string)}</Td>
          <Td className={cx("tabular", Number(r.start_delay_min) > 10 && "font-bold text-warn")}>{r.start_delay_min != null ? `${r.start_delay_min} min` : "–"}</Td>
          <Td className="tabular">{r.duration_min != null ? `${r.duration_min} min` : "–"}</Td>
          <Td className="tabular">{String(r.expected)}</Td><Td className="tabular">{String(r.scanned_board)}</Td><Td className="tabular">{String(r.scanned_drop)}</Td><Td className="tabular">{String(r.manual_marks)}</Td><Td className="tabular">{String(r.exceptions)}</Td>
          <Td>{r.empty_bus_check ? "Yes" : <span className="font-bold text-alert">No</span>}</Td>
        </tr>
      ))}
    </Table>
  );
  if (tab === "compliance") return (
    <Table head={["Bus", "Trips", "Rider trips", "Scanned on (QR)", "Scanned off", "Manual marks", "Both scans %"]}>
      {rows.map((r) => (
        <tr key={String(r.bus)}>
          <Td className="font-semibold">{String(r.bus ?? "–")}</Td><Td className="tabular">{String(r.trips)}</Td><Td className="tabular">{String(r.riders)}</Td>
          <Td className="tabular">{String(r.board_scanned)}</Td><Td className="tabular">{String(r.drop_scanned)}</Td><Td className="tabular">{String(r.manual)}</Td>
          <Td className={cx("tabular font-bold", Number(r.compliance_pct) >= 95 ? "text-safe" : "text-warn")}>{r.compliance_pct != null ? `${r.compliance_pct}%` : "–"}</Td>
        </tr>
      ))}
    </Table>
  );
  if (tab === "exceptions") return (
    <Table head={["Type", "Severity", "Total", "Still open", "Avg. time to resolve"]}>
      {rows.map((r, i) => (
        <tr key={i}><Td className="font-semibold">{EXCEPTION_LABEL[String(r.code)] ?? String(r.code)}</Td><Td>{String(r.severity)}</Td><Td className="tabular">{String(r.total)}</Td><Td className="tabular">{String(r.open)}</Td><Td className="tabular">{r.avg_resolution_min != null ? `${r.avg_resolution_min} min` : "–"}</Td></tr>
      ))}
    </Table>
  );
  if (tab === "safety") return (
    <Table head={["Bus", "Over speed events", "Max speed", "SOS", "Delays reported", "Trips without Empty Bus Check"]}>
      {rows.map((r) => (
        <tr key={String(r.bus)}><Td className="font-semibold">{String(r.bus)}</Td><Td className="tabular">{String(r.overspeed)}</Td><Td className="tabular">{r.max_speed != null ? `${Math.round(Number(r.max_speed))} km/h` : "–"}</Td><Td className="tabular">{String(r.sos)}</Td><Td className="tabular">{String(r.delays)}</Td>
          <Td className={cx("tabular", Number(r.empty_check_missing) > 0 && "font-bold text-alert")}>{String(r.empty_check_missing)}</Td></tr>
      ))}
    </Table>
  );
  return (
    <Table head={["Channel", "Message", "Total", "Delivered/sent", "Failed", "Waiting"]}>
      {rows.map((r, i) => (
        <tr key={i}><Td className="font-semibold">{String(r.channel)}</Td><Td>{String(r.event_type).replace(/_/g, " ").toLowerCase()}</Td><Td className="tabular">{String(r.total)}</Td><Td className="tabular text-safe">{String(r.delivered)}</Td><Td className={cx("tabular", Number(r.failed) > 0 && "font-bold text-alert")}>{String(r.failed)}</Td><Td className="tabular">{String(r.queued)}</Td></tr>
      ))}
    </Table>
  );
}
