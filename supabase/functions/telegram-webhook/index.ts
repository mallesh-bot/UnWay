// Telegram bot webhook. Parents link with /start <invite_code>; staff with /staff <join_code>.
// Telegram sends header X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET.
import { telegramSend } from "../_shared/channels.ts";
import { renderCommandReply } from "../_shared/commands.ts";
import { lang, t } from "../_shared/messages.ts";
import { json, safeEqual, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !safeEqual(secret, given)) return json({ error: "unauthorized" }, 401);

  const update = await req.json().catch(() => null);
  const msg = update?.message ?? update?.edited_message;
  if (!msg?.chat?.id || typeof msg.text !== "string") return json({ ok: true });

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();
  const db = serviceClient();

  try {
    // /start CODE  (deep link from invite: t.me/<bot>?start=CODE)
    const start = text.match(/^\/start(?:\s+(\S+))?/i);
    if (start) {
      if (!start[1]) {
        await telegramSend(chatId, "Welcome to UnWay. Please open the invite link your school shared to connect.");
        return json({ ok: true });
      }
      if (/^staff_/i.test(start[1])) {
        const { data } = await db.rpc("svc_link_staff_telegram", { p_join_code: start[1].slice(6), p_chat_id: chatId });
        await telegramSend(chatId, data?.ok ? t("en", "STAFF_LINKED", { school: data.school }) : t("en", "BAD_CODE"));
        return json({ ok: true });
      }
      const { data } = await db.rpc("svc_link_telegram", {
        p_invite_code: start[1], p_chat_id: chatId,
        p_display: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" "),
      });
      const l = lang(data?.language);
      const linked = data?.ok
        ? t(l, "LINKED", { school: data.school, children: data.children }) + (data.portal_url ? `\n\n${t(l, "PORTAL", { url: data.portal_url })}` : "")
        : t(l, "BAD_CODE");
      await telegramSend(chatId, linked);
      return json({ ok: true });
    }

    const staff = text.match(/^\/staff\s+(\S+)/i);
    if (staff) {
      const { data } = await db.rpc("svc_link_staff_telegram", { p_join_code: staff[1], p_chat_id: chatId });
      await telegramSend(chatId, data?.ok ? t("en", "STAFF_LINKED", { school: data.school }) : t("en", "BAD_CODE"));
      return json({ ok: true });
    }

    const { data, error } = await db.rpc("svc_guardian_command", { p_channel: "telegram", p_address: chatId, p_text: text });
    if (error) throw error;
    await telegramSend(chatId, renderCommandReply(data));
  } catch (e) {
    console.error("telegram-webhook", e);
  }
  // Always 200 so Telegram doesn't retry forever
  return json({ ok: true });
});
