import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
/** Public address of this site. Parent links (/p, /t, /join) point here. */
export const TRACK_BASE_URL = ((import.meta.env.VITE_PUBLIC_URL as string) || window.location.origin).replace(/\/$/, "");
export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = createClient(SUPABASE_URL || "http://localhost:54321", SUPABASE_ANON_KEY || "missing", {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Throws a readable Error for Supabase errors. */
export function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(friendlyError(res.error.message));
  return res.data;
}

export function friendlyError(msg: string): string {
  const map: Record<string, string> = {
    FORBIDDEN: "Your role can't make changes. Ask a school admin.",
    NOT_IN_ORGANIZATION: "Your account isn't linked to a school yet.",
    STOP_NOT_ON_ROUTE: "That stop isn't on the selected route.",
    REASON_REQUIRED: "Please enter a reason.",
    NOTE_REQUIRED: "Please enter a note.",
    PIN_MUST_BE_4_TO_6_DIGITS: "PIN must be 4 to 6 digits.",
    ALREADY_IN_ORGANIZATION: "This account already belongs to a school.",
    ONLY_SCHEDULED_TRIPS_CAN_BE_CANCELLED: "Only trips that haven't started can be cancelled.",
    PLATFORM_ONLY: "Only the UnWay team can do this.",
    ACCOUNT_BELONGS_TO_A_SCHOOL: "This account is a member of a school, so it can't open other schools. Use a separate email for the UnWay console.",
    INVALID_LINK: "This link isn't valid any more. Ask the school for a new one.",
    DATE_OUT_OF_RANGE: "Pick a date between today and the next 90 days.",
  };
  for (const [k, v] of Object.entries(map)) if (msg.includes(k)) return v;
  if (msg.includes("duplicate key")) return "That already exists (duplicate).";
  if (msg.includes("violates foreign key") && msg.includes("route_stops")) return "This stop is used by a route. Remove it from routes first.";
  if (msg.includes("violates foreign key")) return "This item is still in use elsewhere.";
  return msg;
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw new Error(friendlyError(error.message));
  return data as T;
}

export async function adminTool<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-tools", { body });
  if (error) {
    // try to read the JSON error body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = (error as any).context;
    let msg = error.message;
    try { const j = await ctx?.json?.(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data as T;
}
