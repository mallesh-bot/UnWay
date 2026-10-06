// Admin-only helper actions that need server secrets:
//   { action: "invite_user", email, role, name }  -> invite a staff member to the school
//   { action: "setup_telegram" }                   -> register bot webhook + commands
//   { action: "test_telegram", chat_id }           -> send a test message
//   { action: "config" }                           -> public config (bot username, vapid key)
//   { action: "platform_invite_admin", org_id, email, name } -> UnWay team: add a school's first admin
// Caller must be a signed-in school_admin (checked through RLS-aware RPCs).
import { telegramSend } from "../_shared/channels.ts";
import { corsHeaders, json, serviceClient, userClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;
  // public: parents' pages read the bot name and push key
  if (action === "config") {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    let botUsername: string | null = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? null;
    if (!botUsername && token) {
      const r = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()).catch(() => null);
      botUsername = r?.result?.username ?? null;
    }
    return json({
      telegram_bot: botUsername,
      vapid_public_key: Deno.env.get("VAPID_PUBLIC_KEY") ?? null,
      whatsapp_configured: !!Deno.env.get("WHATSAPP_TOKEN"),
      track_base_url: Deno.env.get("TRACK_BASE_URL") ?? null,
    });
  }

  const user = userClient(req);
  const { data: auth } = await user.auth.getUser();
  if (!auth?.user) return json({ error: "Not signed in" }, 401);
  const { data: role } = await user.rpc("my_role");
  const { data: orgId } = await user.rpc("my_org");

  const db = serviceClient();

  if (action === "platform_invite_admin") {
    const { data: isPlatform } = await user.rpc("is_platform_admin");
    if (!isPlatform) return json({ error: "Only the UnWay team can do this" }, 403);
    if (!body.org_id) return json({ error: "org_id required" }, 400);
    return await inviteMember(db, String(body.email ?? ""), "school_admin", String(body.org_id), body.name ?? null, body.redirect_to);
  }

  if (role !== "school_admin" || body.org_id) return json({ error: "Only school admins can do this" }, 403);

  if (action === "invite_user") {
    const newRole = String(body.role ?? "viewer");
    if (!["school_admin", "transport_manager", "viewer"].includes(newRole)) return json({ error: "Bad role" }, 400);
    return await inviteMember(db, String(body.email ?? ""), newRole, String(orgId), body.name ?? null, body.redirect_to);
  }

  if (action === "setup_telegram") {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    if (!token || !secret) return json({ error: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET secrets first" }, 400);
    const hook = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-webhook`;
    const r1 = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: hook, secret_token: secret, allowed_updates: ["message"] }),
    }).then((r) => r.json());
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [
        { command: "status", description: "Where is my child?" },
        { command: "absent", description: "No bus tomorrow (ABSENT TODAY / ABSENT PM)" },
        { command: "help", description: "School contact & commands" },
        { command: "stop", description: "Unsubscribe" },
      ] }),
    });
    const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json());
    return json({ ok: !!r1.ok, webhook: r1, bot: me?.result?.username });
  }

  if (action === "test_telegram") {
    const res = await telegramSend(String(body.chat_id), "✅ UnWay test message: your Telegram alerts are working.");
    return json(res);
  }

  return json({ error: "Unknown action" }, 400);
});

// deno-lint-ignore no-explicit-any
async function inviteMember(db: any, rawEmail: string, role: string, orgId: string, name: string | null, redirect?: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes("@")) return json({ error: "Valid email required" }, 400);
  let userId: string | undefined;
  const inv = await db.auth.admin.inviteUserByEmail(email, { redirectTo: redirect ? String(redirect) : undefined });
  if (inv.error) {
    // already registered? find the user
    const list = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    // deno-lint-ignore no-explicit-any
    userId = list.data?.users.find((u: any) => u.email?.toLowerCase() === email)?.id;
    if (!userId) return json({ error: inv.error.message }, 400);
  } else userId = inv.data.user?.id;
  const { error } = await db.from("org_users").insert({ user_id: userId, org_id: orgId, role, name, email });
  if (error) return json({ error: error.message.includes("duplicate") ? "This user already belongs to a school" : error.message }, 400);
  return json({ ok: true, invited: !inv.error });
}
