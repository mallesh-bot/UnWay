// Local offline storage (SQLite): key/value cache, outgoing event queue, GPS queue.
import * as SQLite from "expo-sqlite";
import type { QueuedEvent } from "./types";

const db = SQLite.openDatabaseSync("unway.db");
db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT);
  CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS locq (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id TEXT, body TEXT NOT NULL);
`);

export function kvGet<T>(k: string): T | null {
  const row = db.getFirstSync<{ v: string }>("SELECT v FROM kv WHERE k = ?", k);
  if (!row) return null;
  try { return JSON.parse(row.v) as T; } catch { return null; }
}
export function kvSet(k: string, v: unknown) {
  db.runSync("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, JSON.stringify(v));
}
export function kvDel(k: string) { db.runSync("DELETE FROM kv WHERE k = ?", k); }

export function enqueue(e: QueuedEvent) {
  db.runSync("INSERT OR IGNORE INTO queue (id, body, created_at) VALUES (?, ?, ?)", e.id, JSON.stringify(e), Date.now());
}
export function peekQueue(limit = 40): QueuedEvent[] {
  return db.getAllSync<{ body: string }>("SELECT body FROM queue ORDER BY created_at LIMIT ?", limit).map((r) => JSON.parse(r.body));
}
export function dequeue(ids: string[]) {
  for (const id of ids) db.runSync("DELETE FROM queue WHERE id = ?", id);
}
export function queueCount(): number {
  return db.getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM queue")?.n ?? 0;
}
export function pendingForTrip(tripId: string): QueuedEvent[] {
  return db.getAllSync<{ body: string }>("SELECT body FROM queue ORDER BY created_at").map((r) => JSON.parse(r.body) as QueuedEvent).filter((e) => e.trip_id === tripId);
}

export function pushLocations(tripId: string | null, points: unknown[]) {
  for (const p of points) db.runSync("INSERT INTO locq (trip_id, body) VALUES (?, ?)", tripId, JSON.stringify(p));
  // never keep more than ~2 days of points if offline for a long time
  db.runSync("DELETE FROM locq WHERE id NOT IN (SELECT id FROM locq ORDER BY id DESC LIMIT 20000)");
}
export function peekLocations(limit = 200): { id: number; trip_id: string | null; body: string }[] {
  return db.getAllSync("SELECT id, trip_id, body FROM locq ORDER BY id LIMIT ?", limit);
}
export function deleteLocationsUpTo(maxId: number) { db.runSync("DELETE FROM locq WHERE id <= ?", maxId); }
export function locationCount(): number {
  return db.getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM locq")?.n ?? 0;
}

export function wipeAll() {
  db.execSync("DELETE FROM kv; DELETE FROM queue; DELETE FROM locq;");
}
