import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { check, supabase } from "../lib/supabase";
import { addDays, fmtDate, todayISO } from "../lib/format";
import { Badge, Button, Empty, Field, Input, PageHeader, Panel, Select, Table, Td } from "../components/ui";

interface Day { org_id: string; date: string; type: string; note: string | null }

export default function CalendarPage() {
  const { org, canWrite } = useAuth();
  const qc = useQueryClient();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [type, setType] = useState("holiday");
  const [note, setNote] = useState("");
  const days = useQuery({
    queryKey: ["calendar"],
    queryFn: async () => check(await supabase.from("calendar_days").select("*").gte("date", addDays(todayISO(), -30)).order("date")) as Day[],
  });
  async function add() {
    const rows: Day[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) rows.push({ org_id: org!.id, date: d, type, note: note || null });
    if (rows.length > 120) return toast.error("Pick 120 days or fewer at a time.");
    const { error } = await supabase.from("calendar_days").upsert(rows);
    if (error) return toast.error(error.message);
    toast.success(`${rows.length} day(s) saved`); setNote(""); qc.invalidateQueries({ queryKey: ["calendar"] });
  }
  async function remove(d: Day) {
    await supabase.from("calendar_days").delete().eq("org_id", d.org_id).eq("date", d.date);
    qc.invalidateQueries({ queryKey: ["calendar"] });
  }
  return (
    <div>
      <PageHeader title="School calendar" sub="No trips are created on holidays. Mark them in advance so buses and parents aren't confused." />
      {canWrite && (
        <Panel className="mb-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="holiday">Holiday (no buses)</option><option value="half_day">Half day</option><option value="exam">Exam day</option><option value="working">Extra working day</option></Select></Field>
            <Field label="Note" className="min-w-56 flex-1"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Dussehra holidays" /></Field>
            <Button variant="primary" onClick={add}>Save</Button>
          </div>
          {type !== "holiday" && <p className="mt-2 text-sm text-ink-3">Half days and exam days still create normal trips. Adjust route times or cancel trips on the Trips page if needed.</p>}
        </Panel>
      )}
      <Panel padded={false}>
        {!days.data?.length ? <Empty title="No special days marked" /> : (
          <Table head={["Date", "Type", "Note", ""]}>
            {days.data.map((d) => (
              <tr key={d.date}><Td className="font-semibold">{fmtDate(d.date)}</Td><Td><Badge tone={d.type === "holiday" ? "warn" : "route"}>{d.type.replace("_", " ")}</Badge></Td><Td>{d.note}</Td>
                <Td className="text-right">{canWrite && <Button size="sm" variant="ghost" onClick={() => remove(d)}>Remove</Button>}</Td></tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
