import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Plus, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth";
import { check, friendlyError, supabase } from "../lib/supabase";
import type { Direction, Route } from "../lib/types";
import { daysLabel, directionLabel } from "../lib/format";
import { byId, useBuses, useRouteStops, useRoutes } from "../lib/queries";
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Panel, Plate, Select, Table, Td } from "../components/ui";

export default function RoutesPage() {
  const { canWrite, org } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const routes = useRoutes();
  const buses = useBuses();
  const rs = useRouteStops();
  const counts = useQuery({
    queryKey: ["route-student-counts"],
    queryFn: async () => check(await supabase.from("transport_assignments").select("route_id").is("effective_to", null)) as { route_id: string }[],
  });
  const busMap = byId(buses.data);
  const [creating, setCreating] = useState(false);

  async function cloneReverse(r: Route) {
    const dir: Direction = r.direction === "MORNING" ? "AFTERNOON" : "MORNING";
    const code = prompt(`Code for the ${directionLabel(dir).toLowerCase()} route`, r.code + (dir === "AFTERNOON" ? "-PM" : "-AM"));
    if (!code) return;
    try {
      const { data, error } = await supabase.from("routes").insert({
        org_id: org!.id, code, name: `${r.name} (${directionLabel(dir)})`, direction: dir, default_bus_id: r.default_bus_id,
        days_mask: r.days_mask, scheduled_start: dir === "AFTERNOON" ? "15:00" : "07:00", campus_id: r.campus_id,
      }).select("id").single();
      if (error) throw error;
      const stops = (rs.data ?? []).filter((x) => x.route_id === r.id).sort((a, b) => b.seq - a.seq);
      if (stops.length) {
        const { error: e2 } = await supabase.from("route_stops").insert(stops.map((s, i) => ({ org_id: org!.id, route_id: data.id, stop_id: s.stop_id, seq: i + 1, planned_offset_min: i * 5 + 10 })));
        if (e2) throw e2;
      }
      toast.success("Reverse route created. Check the times.");
      qc.invalidateQueries(); nav(`/routes/${data.id}`);
    } catch (e) { toast.error(friendlyError((e as Error).message)); }
  }

  return (
    <div>
      <PageHeader title="Routes & stops" sub="A route is one direction of travel. Make a morning and an afternoon route for each bus."
        actions={canWrite && <>
          <Link to="/routes/plan"><Button variant="bus"><Sparkles size={16} /> Auto-plan from home addresses</Button></Link>
          <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> New route</Button>
        </>} />
      <Panel padded={false}>
        {routes.isLoading ? <Loading /> : !routes.data?.length ? (
          <Empty title="No routes yet" action={canWrite && <Button variant="primary" onClick={() => setCreating(true)}>Create the first route</Button>}>
            Create a morning route, add its stops on the map, then make the afternoon route with one click.
          </Empty>
        ) : (
          <Table head={["Route", "Direction", "Bus", "Days", "Starts", "Stops", "Students", ""]}>
            {routes.data.map((r) => (
              <tr key={r.id} className={r.active ? "" : "opacity-50"}>
                <Td><Link to={`/routes/${r.id}`} className="font-semibold hover:underline">{r.code}</Link><span className="block text-xs text-ink-3">{r.name}</span></Td>
                <Td><Badge tone={r.direction === "MORNING" ? "route" : "muted"}>{directionLabel(r.direction)}</Badge></Td>
                <Td>{r.default_bus_id ? <Plate>{busMap[r.default_bus_id]?.display_number ?? "?"}</Plate> : <span className="text-alert">No bus</span>}</Td>
                <Td>{daysLabel(r.days_mask)}</Td>
                <Td className="tabular">{r.scheduled_start.slice(0, 5)}</Td>
                <Td className="tabular">{(rs.data ?? []).filter((x) => x.route_id === r.id).length}</Td>
                <Td className="tabular">{(counts.data ?? []).filter((x) => x.route_id === r.id).length}</Td>
                <Td className="text-right whitespace-nowrap">
                  <Link to={`/routes/${r.id}`}><Button size="sm">Edit stops</Button></Link>{" "}
                  {canWrite && <Button size="sm" variant="ghost" onClick={() => cloneReverse(r)} title="Create the opposite direction with stops reversed"><Copy size={14} /> Reverse</Button>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <NewRoute open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function NewRoute({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { org, campus } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const buses = useBuses();
  const [f, setF] = useState({ code: "", name: "", direction: "MORNING", bus: "", start: "07:00" });
  const [error, setError] = useState<unknown>(null);
  async function save(e: FormEvent) {
    e.preventDefault(); setError(null);
    const { data, error } = await supabase.from("routes").insert({
      org_id: org!.id, campus_id: campus?.id ?? null, code: f.code.trim().toUpperCase(), name: f.name.trim() || f.code,
      direction: f.direction, default_bus_id: f.bus || null, scheduled_start: f.start, days_mask: 63,
    }).select("id").single();
    if (error) return setError(new Error(friendlyError(error.message)));
    qc.invalidateQueries({ queryKey: ["routes"] }); onClose(); nav(`/routes/${data.id}`);
  }
  return (
    <Modal open={open} onClose={onClose} title="New route" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" form="route-form">Create & add stops</Button></>}>
      <form id="route-form" onSubmit={save} className="grid grid-cols-2 gap-3">
        <Field label="Code" hint="Short, e.g. R7"><Input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Direction"><Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value, start: e.target.value === "MORNING" ? "07:00" : "15:00" })}><option value="MORNING">Morning (to school)</option><option value="AFTERNOON">Afternoon (home)</option></Select></Field>
        <Field label="Name" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Kukatpally – Miyapur" /></Field>
        <Field label="Bus"><Select value={f.bus} onChange={(e) => setF({ ...f, bus: e.target.value })}><option value="">Choose later</option>{buses.data?.map((b) => <option key={b.id} value={b.id}>Bus {b.display_number}</option>)}</Select></Field>
        <Field label="Start time"><Input type="time" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <div className="col-span-2"><ErrorBox error={error} /></div>
      </form>
    </Modal>
  );
}
