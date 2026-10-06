// Channel senders: Telegram, WhatsApp Cloud API, Web Push, Email (Resend).
import webpush from "npm:web-push@3.6.7";
import { asStrings, OutboxRow, pushTitle, renderText, trackUrl } from "./messages.ts";

export interface SendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
  permanent?: boolean;      // do not retry
  channelBroken?: boolean;  // mark guardian channel as failed (blocked bot, expired push sub)
}

// ---------------------------------------------------------------- Telegram
export async function telegramSend(chatId: string, text: string): Promise<SendResult> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set", permanent: true };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.ok) return { ok: true, providerId: String(body.result?.message_id ?? "") };
  const desc = body.description ?? `HTTP ${res.status}`;
  if (res.status === 403 || /blocked|chat not found|deactivated/i.test(desc)) {
    return { ok: false, error: desc, permanent: true, channelBroken: true };
  }
  return { ok: false, error: desc, permanent: res.status === 400 };
}

// ---------------------------------------------------------------- WhatsApp
const WA_TEMPLATES: Record<string, { name: string; params: (p: Record<string, string>, url: string) => string[] }> = {
  BOARDED: { name: "unway_boarded", params: (p, url) => [p.student_first_name, p.bus, p.stop, p.time, url] },
  REACHED_SCHOOL: { name: "unway_reached_school", params: (p) => [p.student_first_name, p.time, p.bus] },
  BOARDED_RETURN: { name: "unway_boarded_return", params: (p, url) => [p.student_first_name, p.bus, p.time, url] },
  DROPPED: { name: "unway_dropped", params: (p) => [p.student_first_name, p.stop, p.time, p.bus] },
  MISSED_BOARDING: { name: "unway_missed_boarding", params: (p) => [p.student_first_name, p.bus, p.stop, p.time, p.desk_phone] },
  NOT_BOARDED_RETURN: { name: "unway_not_boarded_return", params: (p) => [p.student_first_name, p.bus, p.desk_phone] },
  KEPT_ON_BUS: { name: "unway_kept_on_bus", params: (p) => [p.student_first_name, p.bus, p.desk_phone] },
  BUS_CHANGED: { name: "unway_bus_changed", params: (p, url) => [p.student_first_name, p.bus, p.usual_bus, url] },
  INCIDENT: { name: "unway_incident_update", params: (p) => [p.school, p.bus, p.message] },
  APPROACHING: { name: "unway_bus_approaching", params: (p) => [p.bus, p.minutes, p.stop, p.student_first_name] },
  WELCOME: { name: "unway_welcome_optin", params: (p) => [p.guardian_name, p.school, p.children] },
};

async function waPost(body: unknown): Promise<SendResult> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const version = Deno.env.get("WHATSAPP_API_VERSION") ?? "v23.0";
  if (!token || !phoneId) return { ok: false, error: "WhatsApp env not configured", permanent: true };
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.messages?.[0]?.id) return { ok: true, providerId: data.messages[0].id };
  const err = data.error?.error_data?.details ?? data.error?.message ?? `HTTP ${res.status}`;
  // 131026 = undeliverable, 131047 = re-engagement (24h window closed), 132001 = template missing
  const code = data.error?.code;
  const permanent = res.status === 400 || [131026, 131047, 132000, 132001, 131051].includes(code);
  return { ok: false, error: `${code ?? ""} ${err}`.trim(), permanent };
}

export async function whatsappSend(row: OutboxRow): Promise<SendResult> {
  const to = row.address.replace(/\D/g, "");
  const mode = (Deno.env.get("WHATSAPP_MODE") ?? "template").toLowerCase();
  const tpl = WA_TEMPLATES[row.event_type];
  if (mode === "text" || !tpl) {
    return waPost({ messaging_product: "whatsapp", to, type: "text", text: { body: renderText(row), preview_url: true } });
  }
  const p = asStrings(row.payload);
  const url = trackUrl(row.payload) ?? "-";
  const params = tpl.params(p, url).map((v) => ({ type: "text", text: (v ?? "").trim() || "-" }));
  return waPost({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: { name: tpl.name, language: { code: row.language === "hi" ? "hi" : row.language === "te" ? "te" : "en" },
                components: [{ type: "body", parameters: params }] },
  });
}

export async function whatsappText(to: string, text: string): Promise<SendResult> {
  return waPost({ messaging_product: "whatsapp", to: to.replace(/\D/g, ""), type: "text", text: { body: text } });
}

// ---------------------------------------------------------------- Web Push
let vapidReady = false;
export async function webpushSend(row: OutboxRow): Promise<SendResult> {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return { ok: false, error: "VAPID keys not set", permanent: true };
  if (!vapidReady) {
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com", pub, priv);
    vapidReady = true;
  }
  let sub: unknown;
  try { sub = JSON.parse(row.address); } catch { return { ok: false, error: "bad subscription", permanent: true, channelBroken: true }; }
  const url = trackUrl(row.payload);
  try {
    // deno-lint-ignore no-explicit-any
    const res: any = await webpush.sendNotification(sub as any, JSON.stringify({
      title: pushTitle(row), body: renderText(row).replace(/\n.*Track.*$/s, ""), url: url ?? undefined,
      tag: `${row.event_type}-${row.payload.student_first_name ?? ""}`,
    }), { TTL: 3600, urgency: "high" });
    return { ok: true, providerId: String(res?.statusCode ?? "201") };
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const status = (e as any)?.statusCode;
    if (status === 404 || status === 410) return { ok: false, error: `subscription gone (${status})`, permanent: true, channelBroken: true };
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

// ---------------------------------------------------------------- Email
export async function emailSend(row: OutboxRow): Promise<SendResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM") ?? "UnWay <onboarding@resend.dev>";
  if (!key) return { ok: false, error: "RESEND_API_KEY not set", permanent: true };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: [row.address], subject: pushTitle(row), text: renderText(row) }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, providerId: data.id };
  return { ok: false, error: data.message ?? `HTTP ${res.status}`, permanent: res.status === 422 };
}

export async function sendRow(row: OutboxRow): Promise<SendResult> {
  try {
    switch (row.channel) {
      case "telegram": return await telegramSend(row.address, renderText(row));
      case "whatsapp": return await whatsappSend(row);
      case "webpush": return await webpushSend(row);
      case "email": return await emailSend(row);
      default: return { ok: false, error: `unknown channel ${row.channel}`, permanent: true };
    }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}
