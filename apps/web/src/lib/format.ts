import type { CustodyState } from "./types";

const TZ = "Asia/Kolkata";

export function fmtTime(ts: string | null | undefined): string {
  if (!ts) return "–";
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}
export function fmtDateTime(ts: string | null | undefined): string {
  if (!ts) return "–";
  return new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: TZ });
}
export function fmtDate(d: string | null | undefined): string {
  if (!d) return "–";
  return new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
export function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}
export function ago(ts: string | null | undefined): string {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export function minutesSince(ts: string | null | undefined): number {
  return ts ? (Date.now() - new Date(ts).getTime()) / 60000 : Infinity;
}

export const STATE_LABEL: Record<CustodyState, string> = {
  EXPECTED: "Expected", ABSENT_NOTIFIED: "Absent (informed)", ON_BOARD: "On bus", DROPPED: "Dropped",
  MISSED: "Missed", NO_SHOW: "Did not come", HANDED_OVER: "Handed over", UNCONFIRMED: "Unconfirmed",
  TRANSFERRED: "Moved to other bus",
};
export const STATE_TONE: Record<CustodyState, "safe" | "alert" | "warn" | "route" | "muted"> = {
  EXPECTED: "muted", ABSENT_NOTIFIED: "muted", ON_BOARD: "route", DROPPED: "safe", MISSED: "alert", NO_SHOW: "warn",
  HANDED_OVER: "safe", UNCONFIRMED: "alert", TRANSFERRED: "muted",
};

export const EXCEPTION_LABEL: Record<string, string> = {
  MISSED_BOARDING: "Didn't board at stop",
  NOT_BOARDED_RETURN: "Didn't board return bus",
  WRONG_BUS: "Wrong bus",
  WRONG_STOP_DROP: "Dropped away from stop",
  DROP_NOT_SCANNED: "Still on bus after stop",
  DROP_UNCONFIRMED: "Drop-off not confirmed",
  GUARDIAN_ABSENT: "No guardian at stop",
  TRIP_LATE_START: "Trip not started",
  DEVICE_OFFLINE: "Bus phone offline",
  CHILD_LEFT_ON_BUS_RISK: "Empty Bus Check missing",
  REVOKED_CARD_USED: "Old card used",
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function daysLabel(mask: number): string {
  if (mask === 127) return "Every day";
  if (mask === 63) return "Mon–Sat";
  if (mask === 31) return "Mon–Fri";
  return DAYS.filter((_, i) => mask & (1 << i)).join(", ") || "Never";
}

export function directionLabel(d: string): string {
  return d === "MORNING" ? "Morning" : "Afternoon";
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Resize an image file to a small JPEG data URL (for student photo thumbnails). */
export async function imageToThumb(file: Blob, size = 160, quality = 0.72): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", quality);
}
