import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowUp, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { friendlyError, supabase } from "../lib/supabase";
import type { Route, Stop } from "../lib/types";
import { DAYS, directionLabel } from "../lib/format";
import { byId, useBuses, useRouteStops, useRoutes, useStops } from "../lib/queries";
import { Button, Field, Input, Loading, Modal, Panel, Select } from "../components/ui";
import MapView, { type MapMarker } from "../components/MapView";

interface Item { stop_id: string; planned_offset_min: number }

export default function RouteEditor() {
  const { id } = useParams<{ id: string }>();
  const { org, campus, canWrite } = useAuth();
  const qc = useQueryClient();
  const routes = useRoutes();
  const stops = useStops();
  const rs = useRouteStops();
  const buses = useBuses();
  const route = routes.data?.find((r) => r.id === id);
  const stopMap = byId(stops.data);

  const [form, setForm] = useState<Partial<Route>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [dirty, setDirty] = useState(false);
  const [newStop, setNewStop] = useState<{ lat: number; lng: number } | null>(null);
  const [addExisting, setAddExisting] = useState("");

  useEffect(() => { if (route) setForm(route); }, [route]);
  useEffect(() => {
    if (!rs.data || dirty) return;
    setItems(rs.data.filter((x) => x.route_id === id).sort((a, b) => a.seq - b.seq).map((x) => ({ stop_id: x.stop_id, planned_offset_min: x.planned_offset_min })));
  }, [rs.data, id, dirty]);

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (campus?.lat && campus.lng) m.push({ id: "school", kind: "school", lat: campus.lat, lng: campus.lng, label: campus.name });
    items.forEach((it, i) => {
      const s = stopMap[it.stop_id];
      if (s) m.push({ id: s.id, kind: "stop", lat: s.lat, lng: s.lng, label: String(i + 1), popup: `<b>${s.name}</b>`, draggable: canWrite });
    });
    return m;
  }, [items, stopMap, campus, canWrite]);

  const line = useMemo(() => {
    const pts = items.map((it) => stopMap[it.stop_id]).filter(Boolean).map((s) => [s.lat, s.lng] as [number, number]);
    if (campus?.lat && campus.lng) {
      if (route?.direction === "MORNING") pts.push([campus.lat, campus.lng]); else pts.unshift([campus.lat, campus.lng]);
    }
    return pts;
  }, [items, stopMap, campus, route?.direction]);

  if (!route) return routes.isLoading ? <Loading /> : <p>Route not found.</p>;

  function move(i: number, d: number) {
    const n = [...items]; const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; setItems(n); setDirty(true);
  }

  async function saveAll() {
    try {
      const { error } = await supabase.from("routes").update({
        name: form.name, default_bus_id: form.default_bus_id || null, scheduled_start: form.scheduled_start,
        days_mask: form.days_mask, active: form.active,
      }).eq("id", route!.id);
      if (error) throw error;
      // replace stop order (assignments reference stops, not route_stops, so this is safe)
      const { error: d } = await supabase.from("route_stops").delete().eq("route_id", route!.id);
      if (d) throw d;
      if (items.length) {
        const { error: e2 } = await supabase.from("route_stops").insert(items.map((it, i) => ({ org_id: org!.id, route_id: route!.id, stop_id: it.stop_id, seq: i + 1, planned_offset_min: it.planned_offset_min })));
        if (e2) throw e2;
      }
      setDirty(false);
      toast.success("Route saved");
      qc.invalidateQueries({ queryKey: ["routes"] }); qc.invalidateQueries({ queryKey: ["route_stops"] });
    } catch (e) { toast.error(friendlyError((e as Error).message)); }
  }

  async function moveStop(stopId: string, lat: number, lng: number) {
    const { error } = await supabase.from("stops").update({ lat, lng }).eq("id", stopId);
    if (error) toast.error(error.message); else { toast.success("Stop moved"); qc.invalidateQueries({ queryKey: ["stops"] }); }
  }

  const usedIds = new Set(items.map((i) => i.stop_id));
  return (
    <div className="space-y-4">
      <Link to="/routes" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-3 hover:text-ink"><ArrowLeft size={15} /> Routes</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{route.code} · {directionLabel(route.direction)}</h1>
          <p className="text-ink-3">{canWrite ? "Click the map to add a stop. Drag a numbered stop to move it." : route.name}</p>
        </div>
        {canWrite && <Button variant="primary" onClick={saveAll}>Save route</Button>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="overflow-hidden neu rounded-[20px]">
          <MapView className="h-[640px] w-full" markers={markers} line={line} fitKey={`${route.id}-${stops.data?.length ?? 0}`}
            circles={items.map((it) => stopMap[it.stop_id]).filter(Boolean).map((s) => ({ lat: s.lat, lng: s.lng, radius: s.radius_m }))}
            center={campus?.lat ? [campus.lat, campus.lng!] : undefined}
            onMapClick={canWrite ? (lat, lng) => setNewStop({ lat, lng }) : undefined}
            onMarkerDrag={(sid, lat, lng) => moveStop(sid, lat, lng)} />
        </div>
        <div className="space-y-4">
          <Panel title="Route details">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" className="col-span-2"><Input disabled={!canWrite} value={form.name ?? ""} onChange={(e) => { setForm({ ...form, name: e.target.value }); setDirty(true); }} /></Field>
              <Field label="Bus"><Select disabled={!canWrite} value={form.default_bus_id ?? ""} onChange={(e) => { setForm({ ...form, default_bus_id: e.target.value }); setDirty(true); }}>
                <option value="">None</option>{buses.data?.map((b) => <option key={b.id} value={b.id}>Bus {b.display_number}</option>)}</Select></Field>
              <Field label="Start time"><Input disabled={!canWrite} type="time" value={(form.scheduled_start ?? "").slice(0, 5)} onChange={(e) => { setForm({ ...form, scheduled_start: e.target.value }); setDirty(true); }} /></Field>
              <div className="col-span-2">
                <span className="mb-1 block text-sm font-semibold text-ink-2">Runs on</span>
                <div className="flex flex-wrap gap-1">
                  {DAYS.map((d, i) => {
                    const on = ((form.days_mask ?? 0) & (1 << i)) !== 0;
                    return <button key={d} type="button" disabled={!canWrite} onClick={() => { setForm({ ...form, days_mask: (form.days_mask ?? 0) ^ (1 << i) }); setDirty(true); }}
                      className={`h-9 w-12 rounded-md border font-semibold ${on ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink-3"}`}>{d}</button>;
                  })}
                </div>
              </div>
              <label className="col-span-2 flex items-center gap-2"><input type="checkbox" disabled={!canWrite} checked={form.active ?? true} onChange={(e) => { setForm({ ...form, active: e.target.checked }); setDirty(true); }} /> Route is active (trips are created every day it runs)</label>
            </div>
          </Panel>
          <Panel title={`Stops in order (${items.length})`} padded={false}>
            <ol className="divide-y divide-line">
              {items.map((it, i) => {
                const s = stopMap[it.stop_id];
                return (
                  <li key={it.stop_id} className="flex items-center gap-2 px-4 py-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-route text-xs font-extrabold">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{s?.name ?? "?"}</div>
                      <label className="flex items-center gap-1 text-xs text-ink-3">+
                        <input type="number" min={0} disabled={!canWrite} className="w-12 rounded border border-line px-1" value={it.planned_offset_min}
                          onChange={(e) => { const n = [...items]; n[i] = { ...it, planned_offset_min: Number(e.target.value) }; setItems(n); setDirty(true); }} />
                        min after start</label>
                    </div>
                    {canWrite && <>
                      <button className="rounded p-1 hover:bg-surface" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={16} /></button>
                      <button className="rounded p-1 hover:bg-surface" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={16} /></button>
                      <button className="rounded p-1 text-ink-3 hover:text-alert" onClick={() => { setItems(items.filter((_, j) => j !== i)); setDirty(true); }} aria-label="Remove stop"><Trash2 size={16} /></button>
                    </>}
                  </li>
                );
              })}
              {items.length === 0 && <li className="px-4 py-6 text-ink-3">No stops yet. Click the map to add one.</li>}
            </ol>
            {canWrite && (
              <div className="flex gap-2 border-t border-line p-3">
                <Select value={addExisting} onChange={(e) => setAddExisting(e.target.value)}>
                  <option value="">Add a stop used by another route…</option>
                  {stops.data?.filter((s) => !usedIds.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
                <Button disabled={!addExisting} onClick={() => { setItems([...items, { stop_id: addExisting, planned_offset_min: (items.at(-1)?.planned_offset_min ?? 0) + 5 }]); setAddExisting(""); setDirty(true); }}>Add</Button>
              </div>
            )}
          </Panel>
          {dirty && <p className="text-sm font-semibold text-warn">You have unsaved changes.</p>}
        </div>
      </div>

      <NewStopModal pos={newStop} onClose={() => setNewStop(null)} onCreated={(s) => {
        setItems([...items, { stop_id: s.id, planned_offset_min: (items.at(-1)?.planned_offset_min ?? -5) + 5 }]); setDirty(true);
        qc.invalidateQueries({ queryKey: ["stops"] });
      }} />
    </div>
  );
}

function NewStopModal({ pos, onClose, onCreated }: { pos: { lat: number; lng: number } | null; onClose: () => void; onCreated: (s: Stop) => void }) {
  const { org, campus } = useAuth();
  const [name, setName] = useState("");
  const [landmark, setLandmark] = useState("");
  const [radius, setRadius] = useState(75);
  useEffect(() => { setName(""); setLandmark(""); setRadius(75); }, [pos]);
  async function save() {
    if (!pos || !name.trim()) return;
    const { data, error } = await supabase.from("stops").insert({ org_id: org!.id, campus_id: campus?.id ?? null, name: name.trim(), landmark: landmark || null, lat: pos.lat, lng: pos.lng, radius_m: radius }).select("*").single();
    if (error) return toast.error(friendlyError(error.message));
    onCreated(data as Stop); onClose();
  }
  return (
    <Modal open={!!pos} onClose={onClose} title="New stop" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!name.trim()}>Add stop</Button></>}>
      <div className="space-y-3">
        <Field label="Stop name" hint="Parents see this name in messages."><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="Sai Nagar Colony gate" /></Field>
        <Field label="Landmark (optional)"><Input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Opposite Ratnadeep" /></Field>
        <Field label="Arrival radius (metres)" hint="The bus counts as 'at the stop' inside this circle. 50–100 m works for most stops.">
          <Input type="number" min={25} max={300} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
        </Field>
      </div>
    </Modal>
  );
}
