// Uploads the offline queues (events + GPS points) and fans out results to the UI.
import * as Crypto from "expo-crypto";
import { isUnauthorized, rpc } from "./api";
import { dequeue, deleteLocationsUpTo, enqueue, kvGet, peekLocations, peekQueue } from "./db";
import type { Fix, QueuedEvent } from "./types";

export type SyncResult = { id: string; ok?: boolean; result?: string; code?: string; [k: string]: unknown };
type Listener = (results: SyncResult[]) => void;
const listeners = new Set<Listener>();
export function onSyncResults(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; }

type UnpairListener = () => void;
const unpairListeners = new Set<UnpairListener>();
export function onUnpaired(l: UnpairListener) { unpairListeners.add(l); return () => { unpairListeners.delete(l); }; }
function emitUnpaired() { unpairListeners.forEach((l) => l()); }

let online = true;
const onlineListeners = new Set<(o: boolean) => void>();
export function onOnline(l: (o: boolean) => void) { onlineListeners.add(l); return () => { onlineListeners.delete(l); }; }
function setOnline(o: boolean) { if (o !== online) { online = o; onlineListeners.forEach((l) => l(o)); } }
export function isOnline() { return online; }

// Latest GPS fix, shared between the background task and the UI
let lastFix: Fix | null = null;
const fixListeners = new Set<(f: Fix) => void>();
export function setFix(f: Fix) { lastFix = f; fixListeners.forEach((l) => l(f)); }
export function getFix() { return lastFix; }
export function onFix(l: (f: Fix) => void) { fixListeners.add(l); return () => { fixListeners.delete(l); }; }

export function newId(): string { return Crypto.randomUUID(); }

/** Queue an event (with current GPS position) and try to upload right away. */
export function queueEvent(e: Omit<QueuedEvent, "id" | "ts" | "lat" | "lng" | "acc"> & { id?: string }): QueuedEvent {
  const f = getFix();
  const ev: QueuedEvent = {
    ...e,
    id: e.id ?? newId(), ts: new Date().toISOString(),
    lat: f?.lat ?? null, lng: f?.lng ?? null, acc: f?.acc ?? null,
    crew_id: e.crew_id ?? kvGet<string>("attendant_id"),
  } as QueuedEvent;
  enqueue(ev);
  void flushEvents();
  return ev;
}

let flushing = false;
export async function flushEvents(): Promise<SyncResult[]> {
  if (flushing) return [];
  flushing = true;
  const all: SyncResult[] = [];
  try {
    for (let round = 0; round < 10; round++) {
      const batch = peekQueue(40);
      if (!batch.length) break;
      const res = await rpc<{ results: SyncResult[] }>("dev_sync", { p_events: batch });
      setOnline(true);
      dequeue(res.results.map((r) => r.id));
      all.push(...res.results);
      if (batch.length < 40) break;
    }
  } catch (e) {
    if (isUnauthorized(e)) emitUnpaired(); else setOnline(false);
  } finally {
    flushing = false;
  }
  if (all.length) listeners.forEach((l) => l(all));
  return all;
}

let flushingLoc = false;
let lastLocFlush = 0;
export async function flushLocations(force = false): Promise<void> {
  if (flushingLoc || (!force && Date.now() - lastLocFlush < 10_000)) return;
  flushingLoc = true;
  lastLocFlush = Date.now();
  try {
    for (let round = 0; round < 20; round++) {
      const rows = peekLocations(200);
      if (!rows.length) break;
      const tripId = rows[0].trip_id;
      const same = rows.filter((r) => r.trip_id === tripId);
      const battery = kvGet<number>("battery");
      await rpc("dev_locations", { p_trip_id: tripId, p_points: same.map((r) => JSON.parse(r.body)), p_battery: battery });
      setOnline(true);
      deleteLocationsUpTo(same[same.length - 1].id);
      if (rows.length < 200) break;
    }
  } catch (e) {
    if (isUnauthorized(e)) emitUnpaired(); else setOnline(false);
  } finally {
    flushingLoc = false;
  }
}
