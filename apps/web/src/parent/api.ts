import { supabase } from "../lib/supabase";

export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string) || "";
const ENV_BOT = (import.meta.env.VITE_TELEGRAM_BOT as string) || "";

export interface Snapshot {
  ok: boolean; code?: string; date: string; child: string; school: string;
  campus: { name: string; lat: number | null; lng: number | null; desk_phone: string | null } | null;
  events: { direction: "MORNING" | "AFTERNOON"; state: string; board_at: string | null; drop_at: string | null; bus: string | null; trip_status: string }[];
  trip: { direction: "MORNING" | "AFTERNOON"; status: string; bus: string | null; state: string; started_at: string | null; completed_at: string | null } | null;
  live: { lat: number; lng: number; heading: number | null; speed_kmh: number | null; updated_at: string } | null;
  stops: { id: string; name: string; lat: number; lng: number; seq: number; mine: boolean }[];
  eta: { to: string; minutes: number } | null;
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const snapshot = (token: string) => call<Snapshot>("track_snapshot", { p_token: token });

export interface JoinInfo { ok: boolean; guardian: string; school: string; language: string; children: string[]; channels: string[]; portal_token?: string }
export const joinInfo = (code: string) => call<JoinInfo>("join_info", { p_invite_code: code });

export type Dir = "MORNING" | "AFTERNOON";
export interface PortalChild {
  id: string; first_name: string; last_name: string; class: string; photo: string | null; transport_status: string; track_token: string;
  routes: { direction: Dir; route: string; bus: string | null; stop: string; stop_lat: number; stop_lng: number; time: string | null }[];
  today: { direction: Dir; state: string; board_at: string | null; drop_at: string | null; bus: string | null; trip_status: string; reason: string | null }[];
  absences: { id: string; date: string; legs: "AM" | "PM" | "BOTH"; source: string }[];
  stats: { rides: number; missed: number; absent: number; days: number };
}
export interface Portal {
  guardian: { name: string; language: "en" | "hi" | "te"; phone: string | null; invite_code: string; channels: { channel: string; status: string }[] };
  school: { name: string; campus: { name: string; desk_phone: string | null; lat: number | null; lng: number | null } | null; channels: Record<string, boolean> };
  today: string; children: PortalChild[]; server_ts: string;
}
export interface HistoryDay { date: string; legs: { direction: Dir; state: string; board_at: string | null; drop_at: string | null; bus: string | null; stop: string | null }[] }

export const portal = (token: string) => call<Portal>("parent_portal", { p_token: token });
export const history = (token: string, student: string, days = 30) => call<HistoryDay[]>("parent_history", { p_token: token, p_student: student, p_days: days });
export const setAbsence = (token: string, student: string, date: string, legs: string) =>
  call<{ ok: boolean }>("parent_set_absence", { p_token: token, p_student: student, p_date: date, p_legs: legs });
export const cancelAbsence = (token: string, id: string) => call<{ ok: boolean }>("parent_cancel_absence", { p_token: token, p_absence: id });
export const setPrefs = (token: string, prefs: { language?: string; channel?: string; paused?: boolean }) =>
  call<{ ok: boolean }>("parent_set_preferences", { p_token: token, p_language: prefs.language ?? null, p_paused_channel: prefs.channel ?? null, p_paused: prefs.paused ?? null });

let botCache: Promise<string> | null = null;
/** Telegram bot username: from the build env, or asked from the server once. */
export function telegramBot(): Promise<string> {
  if (ENV_BOT) return Promise.resolve(ENV_BOT);
  botCache ??= supabase.functions.invoke("admin-tools", { body: { action: "config" } })
    .then(({ data }) => (data?.telegram_bot as string) || "").catch(() => "");
  return botCache;
}

function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type PushResult = "ok" | "unsupported" | "denied" | "error";
/** Subscribe this browser to Web Push. `who` is either {invite} (join page) or {portal} (parent page). */
export async function subscribePush(who: { invite?: string; portal?: string }): Promise<PushResult> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC_KEY) return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "denied";
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource });
    const { data, error } = who.portal
      ? await supabase.rpc("parent_webpush_subscribe", { p_token: who.portal, p_subscription: sub.toJSON() })
      : await supabase.rpc("webpush_subscribe", { p_invite_code: who.invite, p_subscription: sub.toJSON() });
    if (error || !data?.ok) return "error";
    return "ok";
  } catch { return "error"; }
}

export function rememberPortal(token: string) { try { localStorage.setItem("unway-portal", token); } catch { /* ignore */ } }
export function rememberedPortal(): string | null { try { return localStorage.getItem("unway-portal"); } catch { return null; } }
