# UnWay setup guide (free tier)

This guide takes you from zero to a working pilot: dashboard online, bus phone paired, parents getting messages. It takes about 60–90 minutes the first time. Everything here is free except optional WhatsApp messages.

You need:
- A computer with **Node.js 20 or newer** (`node -v` to check; get it from nodejs.org)
- A free **Supabase** account (supabase.com)
- A free **Cloudflare** account (cloudflare.com), for hosting the two websites
- A free **Expo** account (expo.dev), for building the Android app
- **Telegram** on your phone, for the free parent channel
- An Android phone for the bus (Android 8+)

Open a terminal (PowerShell on Windows) in this folder (`Unway`).

---

## 1. Create the database (Supabase)

1. In Supabase, click **New project**. Name it `unway`, choose region **South Asia (Mumbai)**, and set a strong database password (save it).
2. Wait until the project is ready. Open **Project Settings → API** and note:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon / publishable key**
   - **Project ref** (the `abcd1234` part)
3. Open **Database → Extensions** and enable **pg_cron** and **pg_net**.
4. Install the migrations from this folder:
   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```
   This creates all tables, security rules, and scheduled jobs.

   **No CLI?** Open **SQL Editor** in Supabase and run each file in `supabase/migrations` in order (oldest first). Copy each file's content and click Run.

5. **Auth settings:** open **Authentication → URL Configuration** and set **Site URL** to your dashboard address (step 4). For now you can use `http://localhost:5173`.

## 2. Deploy the server functions

Create the secrets the functions use. Replace the values in capitals. Make up the random ones; any long random string works.

```powershell
npx supabase secrets set DISPATCH_SECRET=MAKE_UP_A_LONG_RANDOM_STRING
npx supabase secrets set TRACK_BASE_URL=https://unway-track.pages.dev
```

Deploy:
```powershell
npx supabase functions deploy dispatch --no-verify-jwt
npx supabase functions deploy telegram-webhook --no-verify-jwt
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
npx supabase functions deploy admin-tools --no-verify-jwt
```

Let the database trigger the sender. In **SQL Editor**, run this, using the same DISPATCH_SECRET:
```sql
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co/functions/v1', 'unway_functions_url');
select vault.create_secret('MAKE_UP_A_LONG_RANDOM_STRING', 'unway_dispatch_secret');
```

## 3. Parent channels (free)

### Telegram (recommended)
1. In Telegram, open **@BotFather**, send `/newbot` and follow the steps. Copy the **token**.
2. Set the secrets and redeploy so the functions pick them up:
   ```powershell
   npx supabase secrets set TELEGRAM_BOT_TOKEN=123456:ABC... TELEGRAM_WEBHOOK_SECRET=ANOTHER_RANDOM_STRING TELEGRAM_BOT_USERNAME=YourBotName
   ```
3. Later, in the dashboard, open **Settings → Parent messages → Connect Telegram bot**. That registers the webhook.

### Browser alerts (Web Push)
```powershell
npx web-push generate-vapid-keys
npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@school.in
```
Use the same public key as `VITE_VAPID_PUBLIC_KEY` in the parent site (step 4).

### WhatsApp (optional, paid per message)
1. Go to developers.facebook.com, create an app of type **Business**, and add **WhatsApp**. You get a free test number that can message up to 5 verified numbers.
2. Create the message templates listed in `docs/WHATSAPP_TEMPLATES.md` (category **Utility**) and wait for approval.
3. Set the secrets:
   ```powershell
   npx supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=ANY_RANDOM_STRING
   ```
4. In the Meta app, open **WhatsApp → Configuration → Webhook** and set the callback URL to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook` and the verify token to `WHATSAPP_VERIFY_TOKEN`. Subscribe to **messages**.
5. Until templates are approved you can set `WHATSAPP_MODE=text`. This only works within 24 hours after the parent last messaged you.
6. In the dashboard, open **Settings → Parent messages** and tick WhatsApp. On each student page, use **Enable WhatsApp** for parents who agreed.

## 4. Put the website online (Cloudflare Pages, free)

There is one website, `apps/web`, with three dashboards inside it:

| Address | Who | Sign-in |
|---|---|---|
| `/` | School staff (school dashboard) | Email + password |
| `/platform` | The UnWay team (console for every school) | Email + password, email must be on the UnWay team list |
| `/p/<link>` | Parents (their own page) | None: the personal link is the key |

```powershell
cd apps/web
copy .env.example .env.local     # Supabase URL + anon key + VAPID public key
npm install
npm run build
npx wrangler pages deploy dist --project-name unway
```

Wrangler prints the address (e.g. `https://unway.pages.dev`). Then:
- Put it in Supabase **Authentication → URL Configuration → Site URL** and **Redirect URLs**.
- Put it in the `TRACK_BASE_URL` function secret (step 2) and in the school dashboard under **Settings → UnWay site address**. Parent links in messages use it.

You can try it locally first with `npm run dev` at http://localhost:5173.

## 5. First login and data

1. Open the dashboard, choose **New school? Create account**, confirm your email and sign in.
2. Fill in the school name, short code (3–6 letters, printed in QR cards) and click the school gate on the map.
3. On the **Live map** page, click **Load demo data** to get 2 buses, 16 students and routes around your school. The crew PIN is **1234**. Or add your real data:
   - **Buses & crew**: add buses, drivers and attendants. Leave the PIN empty and UnWay creates one.
   - **Routes & stops**: easiest is **Auto-plan routes**. Import students with a `home_address` column, click **Find them on the map**, then **Plan routes** and **Apply plan**. Or draw routes by hand: create a morning route, click the map to add stops, then use **Reverse**.
   - **Students**: add students one by one or use **Import CSV**, then set each student's morning and afternoon stop.
   - **Students → select → Print QR cards**: print, laminate and hand them out.
   - **Parents → Print invite slips**: parents scan the slip to connect Telegram or browser alerts.

## 6. The bus phone app

Build an installable APK in the cloud (free Expo account):
```powershell
cd apps/bus
npm install
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview
```
When the build finishes, open the link on the bus phone and install the APK. You may need to allow "install unknown apps".

On the phone:
1. Open **UnWay Bus** and tap **Scan pairing code**.
2. In the dashboard, open **Buses & crew → Pair phone** and scan the QR code shown.
3. Allow camera and **location: Allow all the time**. In Android settings, set battery use for UnWay Bus to **Unrestricted**.
4. Pick the crew, enter the PIN and start the trip.

**No bus handy?** Run the simulator. It plays a whole trip using a pairing code:
```powershell
node scripts/simulate-bus.mjs https://YOUR_PROJECT_REF.supabase.co YOUR_ANON_KEY PAIRCODE
```
Pairing the simulator signs out any real phone paired to that bus. Pair the phone again afterwards.

## 7. Keep the free project awake

Supabase pauses free projects after 7 days without activity, for example over school holidays. During term the buses keep it busy. For holidays, add a free uptime monitor at uptimerobot.com that opens your parent site every day, or log in to the dashboard once a week.

## Troubleshooting

| Problem | Fix |
|---|---|
| Parents don't get messages | Check **Reports → Parent messages** for failures. Check that the guardian has an active channel (Parents page) and that the Telegram bot is connected (Settings). Look at function logs in Supabase → Edge Functions → dispatch. |
| Messages only arrive after a minute | The `unway_functions_url` / `unway_dispatch_secret` vault secrets are missing, so only the 30-second cron retry sends them. |
| Bus shows "offline" | Phone data is off, or Android killed the app. Set battery to Unrestricted and keep the phone on a charger. |
| "Pairing code invalid" | Codes expire after 15 minutes. Create a new one. |
| Scans show "card not valid" | The card is from another school, or was replaced. Print the current card from the student page. |

## 7. The UnWay console (for your team)

1. Sign up on the login page with **palukurimallesh@gmail.com** (already on the team list). That account opens **/platform** automatically.
2. Add teammates under **UnWay team**. Use a different email for any test school you run yourself: an account that belongs to a school can't open other schools.
3. **Schools → Add school** creates a school and emails its admin an invite. **Open school dashboard** shows that school read-only, with a yellow banner and a button back to the console.
4. Pausing a school (status **Paused**) stops its bus phones and parent messages.
