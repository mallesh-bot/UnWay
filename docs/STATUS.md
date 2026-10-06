# Deployment status (4 Oct 2026)

Your Supabase project **zystjqgdriojyjspbcxq** is set up and passed a live end-to-end test of all three dashboards.

## Already done

| Item | Status |
|---|---|
| Database: 11 migrations (tables, security, trip engine, reports, UnWay console, parent page, automation) | ✅ applied |
| Scheduled jobs: every minute (late trips, offline phones, escalation), every 30 s (send messages), midnight (trips, learned stop times, clean-up), 6 pm (evening summary) | ✅ running |
| Server functions: `dispatch`, `telegram-webhook`, `whatsapp-webhook`, `admin-tools` | ✅ deployed |
| Secrets, Vault, Realtime, auth redirect for `http://localhost:5173` | ✅ set |
| `apps/web/.env.local` pointing at your project | ✅ created |
| UnWay team list | ✅ `palukurimallesh@gmail.com` |

The live test created a school, loaded demo data, planned routes automatically, ran a trip from a simulated bus phone (scans, "bus is coming" alerts), opened the parent page, and used the console (overview, schools, "view as school", messages, health). The test data was deleted afterwards. Your own school (**CMS**) was left untouched.

## Still to do (you)

1. **Run it**: double-click `start-unway.bat`, or `cd apps/web`, `npm install`, `npm run dev`, then open http://localhost:5173.
   - Sign up with **palukurimallesh@gmail.com** to get the UnWay console.
   - Your existing school accounts open the school dashboard.
2. **Telegram bot** (free parent messages): create a bot with @BotFather, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` in Supabase → Edge Functions → Secrets, then click **Settings → Connect Telegram bot** in the school dashboard. Until then, parent messages fail; the console's **Messages** page shows this.
3. **Put the site online** with Cloudflare Pages (docs/SETUP.md, step 4). Add the address to Supabase → Authentication → URL Configuration, to the `TRACK_BASE_URL` secret, and to the school's **Settings → UnWay site address**.
4. **Bus app APK**: `cd apps/bus`, `npm install`, `npx eas-cli@latest build -p android --profile preview` (free Expo account).
5. **Security**: revoke the personal access token you shared (supabase.com/dashboard/account/tokens) and consider changing the database password.
6. Optional: WhatsApp (docs/WHATSAPP_TEMPLATES.md, including the new `unway_bus_approaching` template).
