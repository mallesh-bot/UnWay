// Pure trip logic, mirrored from the server so scans work fully offline.
import * as Crypto from "expo-crypto";
import type { Bootstrap, Fix, Rider, Stop, TripData } from "./types";

export function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface ParsedQr { org: string; publicId: string; version: number }
export function parseQr(raw: string): ParsedQr | null {
  const p = raw.trim().split(".");
  if (p.length !== 5 || p[0] !== "UW1" || !/^\d+$/.test(p[3])) return null;
  return { org: p[1], publicId: p[2], version: Number(p[3]) };
}

export type ScanVerdict =
  | { kind: "ok"; rider: Rider; type: "BOARD" | "DEBOARD" }
  | { kind: "handover"; rider: Rider }
  | { kind: "duplicate"; rider: Rider; at: string | null }
  | { kind: "already_dropped"; rider: Rider }
  | { kind: "wrong_bus"; name: string; bus: string | null; publicId: string }
  | { kind: "invalid" | "revoked" | "unknown" | "other_school" };

export function evaluateScan(raw: string, trip: TripData, boot: Bootstrap, lastScan: Record<string, number>): ScanVerdict {
  const q = parseQr(raw);
  if (!q) return { kind: "invalid" };
  if (q.org !== boot.org.short_code) return { kind: "other_school" };
  const rider = trip.manifest.find((r) => r.public_id === q.publicId);
  if (!rider) {
    const other = trip.other_buses.find((o) => o.public_id === q.publicId);
    if (other) return { kind: "wrong_bus", name: other.name, bus: other.bus, publicId: q.publicId };
    return { kind: "unknown" };
  }
  if (q.version < rider.cred_version) return { kind: "revoked" };
  const windowMs = (boot.policies.dup_window_s ?? 120) * 1000;
  const last = lastScan[rider.student_id];
  if (last && Date.now() - last < windowMs) return { kind: "duplicate", rider, at: rider.board_at ?? rider.drop_at };
  if (rider.state === "DROPPED" || rider.state === "HANDED_OVER" || rider.state === "TRANSFERRED") return { kind: "already_dropped", rider };
  if (rider.state === "ON_BOARD") {
    if (trip.trip.direction === "AFTERNOON" && rider.handover_required) return { kind: "handover", rider };
    return { kind: "ok", rider, type: "DEBOARD" };
  }
  return { kind: "ok", rider, type: "BOARD" };
}

/** Stop the bus is at (inside radius), or null. */
export function stopAt(stops: Stop[], fix: Fix | null): Stop | null {
  if (!fix || (fix.acc ?? 0) > 80) return null;
  let best: Stop | null = null, bestD = Infinity;
  for (const s of stops) {
    const d = distM(fix.lat, fix.lng, s.lat, s.lng);
    if (d <= s.radius_m && d < bestD) { best = s; bestD = d; }
  }
  return best;
}

export function atSchool(trip: TripData, fix: Fix | null): boolean {
  const s = trip.school;
  if (!fix || !s?.lat || !s.lng) return false;
  return distM(fix.lat, fix.lng, s.lat, s.lng) <= (s.radius_m ?? 150);
}

export function counts(trip: TripData) {
  const m = trip.manifest.filter((r) => r.state !== "ABSENT_NOTIFIED" && r.state !== "TRANSFERRED");
  return {
    expected: m.length,
    onBoard: m.filter((r) => r.state === "ON_BOARD").length,
    dropped: m.filter((r) => r.state === "DROPPED" || r.state === "HANDED_OVER").length,
    waiting: m.filter((r) => r.state === "EXPECTED").length,
    missing: m.filter((r) => r.state === "MISSED" || r.state === "UNCONFIRMED").length,
  };
}

export function fmtTime(ts: string | number | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export async function sha256Hex(text: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; }
  return 0;
}
