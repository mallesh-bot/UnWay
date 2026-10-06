// WhatsApp Cloud API webhook: verification (GET), delivery statuses and inbound
// parent messages (POST). Verifies X-Hub-Signature-256 with WHATSAPP_APP_SECRET.
import { whatsappText } from "../_shared/channels.ts";
import { renderCommandReply } from "../_shared/commands.ts";
import { json, safeEqual, serviceClient } from "../_shared/supabase.ts";

async function validSignature(raw: string, header: string | null): Promise<boolean> {
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!appSecret) return false;
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(hex, header.slice(7));
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("forbidden", { status: 403 });
  }

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-hub-signature-256")))) return json({ error: "bad signature" }, 401);
  const body = JSON.parse(raw);
  const db = serviceClient();

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const st of value.statuses ?? []) {
        await db.rpc("svc_outbox_status", {
          p_provider_id: st.id, p_status: st.status,
          p_error: st.errors?.[0] ? `${st.errors[0].code} ${st.errors[0].title}` : null,
        });
      }
      for (const m of value.messages ?? []) {
        const from = String(m.from);
        const text = m.type === "text" ? m.text?.body : m.type === "button" ? m.button?.text : m.interactive?.button_reply?.title;
        if (!text) continue;
        try {
          const { data } = await db.rpc("svc_guardian_command", { p_channel: "whatsapp", p_address: from, p_text: text });
          // Replying inside the 24 h window is a service message (charged after the free monthly quota).
          await whatsappText(from, renderCommandReply(data));
        } catch (e) {
          console.error("whatsapp inbound", e);
        }
      }
    }
  }
  return json({ ok: true });
});
