import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { useAuth } from "../lib/auth";
import { check, rpc, supabase } from "../lib/supabase";
import type { ManifestRow, Trip } from "../lib/types";
import { addDays, directionLabel, fmtTime, todayISO } from "../lib/format";
import { byId, useBuses, useRoutes } from "../lib/queries";
import { Badge, Button, CustodyBar, Empty, ErrorBox, Input, Loading, PageHeader, Panel, Plate, Table, Td } from "../components/ui";

export const TRIP_STATUS: Record<Trip["status"], { label: string; tone: "safe" | "alert" | "warn" | "route" | "muted" }> = {
  scheduled: { label: "Not started", tone: "muted" }, active: { label: "Running", tone: "route" },
  completed: { label: "Completed", tone: "safe" }, completed_forced: { label: "Closed by admin", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "muted" }, aborted_auto: { label: "Never completed", tone: "alert" },
};

export default function Trips() {
  const { canWrite } = useAuth();
  const [date, setDate] = useState(todayISO());
  const routes = useRoutes();
  const buses = useBuses();
  const routeMap = byId(routes.data), busMap = byId(buses.data);
  const trips = useQuery({
    queryKey: ["trips", date], refetchInterval: 20_000,
    queryFn: async () => {
      const t = check(await supabase.from("trips").select("*").eq("trip_date", date).order("scheduled_start")) as Trip[];
      const m = t.length ? check(await supabase.from("trip_manifest").select("trip_id,state").in("trip_id", t.map((x) => x.id))) as Pick<ManifestRow, "trip_id" | "state">[] : [];
      return t.map((trip) => {
        const rows = m.filter((x) => x.trip_id === trip.id && !["ABSENT_NOTIFIED", "TRANSFERRED"].includes(x.state));
        return { trip, expected: rows.length, onBoard: rows.filter((r) => r.state === "ON_BOARD").length,
          dropped: rows.filter((r) => r.state === "DROPPED" || r.state === "HANDED_OVER").length,
          missing: rows.filter((r) => ["MISSED", "UNCONFIRMED"].includes(r.state)).length };
      });
    },
  });

  async function generate() {
    try { const n = await rpc<number>("generate_trips", { p_date: date }); toast.success(n ? `${n} trips created` : "Trips were already created for this day"); trips.refetch(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div>
      <PageHeader title="Trips" sub="Trips are created automatically each day from active routes."
        actions={<>
          <Button size="sm" variant="ghost" onClick={() => setDate(addDays(date, -1))}>Previous day</Button>
          <Input type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} />
          <Button size="sm" variant="ghost" onClick={() => setDate(addDays(date, 1))}>Next day</Button>
          {canWrite && <Button onClick={generate}><CalendarPlus size={16} /> Create trips</Button>}
        </>} />
      <ErrorBox error={trips.error} />
      <Panel padded={false}>
        {trips.isLoading ? <Loading /> : !trips.data?.length ? (
          <Empty title="No trips on this day" action={canWrite && <Button variant="primary" onClick={generate}>Create trips from routes</Button>}>
            Holidays have no trips. If routes are set up, trips appear automatically after midnight.
          </Empty>
        ) : (
          <Table head={["Bus", "Route", "Scheduled", "Started", "Status", "Children", ""]}>
            {trips.data.map(({ trip: t, ...c }) => (
              <tr key={t.id}>
                <Td>{t.bus_id ? <Plate>{busMap[t.bus_id]?.display_number ?? "?"}</Plate> : "–"}</Td>
                <Td><span className="font-semibold">{routeMap[t.route_id]?.code}</span> <span className="text-ink-3">{directionLabel(t.direction)}</span></Td>
                <Td className="tabular">{fmtTime(t.scheduled_start)}</Td>
                <Td className="tabular">{fmtTime(t.started_at)}</Td>
                <Td><Badge tone={TRIP_STATUS[t.status].tone}>{TRIP_STATUS[t.status].label}</Badge></Td>
                <Td className="w-56">
                  <CustodyBar expected={c.expected} onBoard={c.onBoard} dropped={c.dropped} missing={c.missing} />
                  <span className="text-xs text-ink-3 tabular">{c.dropped}/{c.expected} dropped{c.missing ? ` · ${c.missing} missing` : ""}</span>
                </Td>
                <Td className="text-right"><Link to={`/trips/${t.id}`}><Button size="sm">Open</Button></Link></Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
