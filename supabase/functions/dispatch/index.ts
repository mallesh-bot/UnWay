// Sends queued notifications (outbox pattern). Triggered by the database
// (pg_net kick) and by pg_cron every 30 s for retries.
// Auth: header x-unway-secret must equal DISPATCH_SECRET.
import { sendRow } from "../_shared/channels.ts";
import type { OutboxRow } from "../_shared/messages.ts";
import { corsHeaders, json, safeEqual, serviceClient } from "../_shared/supabase.ts";

const TIME_BUDGET_MS = 25_000;
// Telegram: ~30 msg/s overall, 1 msg/s per chat. Keep a small concurrency.
const CONCURRENCY = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const secret = Deno.env.get("DISPATCH_SECRET") ?? "";
  const given = req.headers.get("x-unway-secret") ?? "";
  if (!secret || !safeEqual(secret, given)) return json({ error: "unauthorized" }, 401);

  const db = serviceClient();
  const started = Date.now();
  let sent = 0, failed = 0;

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: rows, error } = await db.rpc("svc_outbox_claim", { p_limit: 40 });
    if (error) return json({ error: error.message }, 500);
    const batch = (rows ?? []) as OutboxRow[];
    if (batch.length === 0) break;

    // process with limited concurrency, one message per chat at a time
    const queue = [...batch];
    const busyChats = new Set<string>();
    async function worker() {
      while (queue.length) {
        const idx = queue.findIndex((r) => !busyChats.has(r.channel + r.address));
        if (idx === -1) { await new Promise((r) => setTimeout(r, 1100)); continue; }
        const row = queue.splice(idx, 1)[0];
        const key = row.channel + row.address;
        busyChats.add(key);
        const res = await sendRow(row);
        if (res.ok) sent++; else failed++;
        await db.rpc("svc_outbox_result", {
          p_id: row.id, p_ok: res.ok, p_provider_id: res.providerId ?? null,
          p_error: res.error ?? null, p_permanent: res.permanent ?? false,
        });
        if (res.channelBroken) await db.rpc("svc_channel_failed", { p_channel: row.channel, p_address: row.address });
        if (row.channel === "telegram") await new Promise((r) => setTimeout(r, 1000));
        busyChats.delete(key);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }
  return json({ sent, failed, ms: Date.now() - started });
});
