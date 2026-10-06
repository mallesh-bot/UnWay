// Talks to the UnWay backend (Supabase PostgREST RPCs). The device authenticates
// with its own secret token, passed as the first argument of every dev_* function.
import * as SecureStore from "expo-secure-store";
import type { Config } from "./types";

let cached: Config | null = null;

export async function loadConfig(): Promise<Config | null> {
  if (cached) return cached;
  const [url, key, token, deviceId] = await Promise.all([
    SecureStore.getItemAsync("unway_url"), SecureStore.getItemAsync("unway_key"),
    SecureStore.getItemAsync("unway_token"), SecureStore.getItemAsync("unway_device"),
  ]);
  if (!url || !key || !token) return null;
  cached = { url, key, token, deviceId: deviceId ?? "" };
  return cached;
}

export async function saveConfig(c: Config) {
  await SecureStore.setItemAsync("unway_url", c.url);
  await SecureStore.setItemAsync("unway_key", c.key);
  await SecureStore.setItemAsync("unway_token", c.token);
  await SecureStore.setItemAsync("unway_device", c.deviceId);
  cached = c;
}

export async function clearConfig() {
  await Promise.all(["unway_url", "unway_key", "unway_token", "unway_device"].map((k) => SecureStore.deleteItemAsync(k)));
  cached = null;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public network = false) { super(message); }
}

/** Calls a Postgres function through PostgREST. */
export async function callRpc<T>(url: string, key: string, fn: string, args: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify(args),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(String((e as Error)?.message ?? e), 0, true);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body as { message?: string })?.message ?? `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
  const c = await loadConfig();
  if (!c) throw new ApiError("NOT_PAIRED", 401);
  return callRpc<T>(c.url, c.key, fn, { p_token: c.token, ...args }, timeoutMs);
}

export function isUnauthorized(e: unknown): boolean {
  return e instanceof ApiError && /DEVICE_UNAUTHORIZED/.test(e.message);
}
