# UnWay: school transport, every child accounted for

UnWay connects schools, buses, students and parents. A phone on each bus scans each child's QR card as they get on and off. The school watches every bus live, and parents get messages on Telegram, browser alerts or WhatsApp.

See **PRD.md** for the full product spec and **docs/SETUP.md** for step-by-step deployment.

## What's in this folder

| Folder | What it is | Tech |
|---|---|---|
| `supabase/migrations` | Database: tables, security rules, trip/scan/custody engine, reports, scheduled jobs | Postgres (Supabase) |
| `supabase/functions` | Server functions: sending notifications, Telegram & WhatsApp webhooks, admin tools | Deno (Supabase Edge Functions) |
| `supabase/tests` | Database test suite (end-to-end trip simulation, security isolation) | SQL |
| `apps/web` | One website, three dashboards: **school dashboard** (`/`), **UnWay console** for your team (`/platform`) and the **parent page** (`/p/<personal link>`, plus live tracking at `/t/…`) | React + Vite + Tailwind + MapLibre |
| `apps/bus` | Android app for the bus phone: pairing, crew sign-in, QR scanning (offline), GPS, Empty Bus Check, SOS | Expo / React Native |
| `scripts/simulate-bus.mjs` | Pretends to be a bus so you can demo everything without a real bus | Node |

## How it works (one trip)

1. The attendant opens **UnWay Bus**, picks the crew, enters a PIN and taps **Start trip**. The phone downloads the list of expected children with their photos, so scanning keeps working without network.
2. Each child shows their card. The phone shows a big green screen with the child's photo and name, and the event is queued and uploaded.
3. The database records the scan, updates the child's status and queues a parent message. The `dispatch` function sends it on Telegram, web push or WhatsApp.
4. If the bus leaves a stop without an expected child, the phone asks why. Otherwise the server marks the child "missed", alerts the parent and opens an exception on the dashboard.
5. A trip can't finish until every child has a status and the **Empty Bus Check** is confirmed with a PIN.

## What runs by itself

- Trips and passenger lists for tomorrow are created every night (holidays skipped).
- Parents get a message on every scan, a "bus is about N minutes away" heads-up, and alerts when a child is missed.
- Alerts nobody handles are sent to staff again after a few minutes (SOS after 3).
- Staff get an evening summary at 6 pm.
- Planned stop times adjust every night to how long the bus really takes.
- New parents get a WhatsApp invite automatically (when WhatsApp is on), and can join by replying.
- **Auto-plan routes** groups homes into stops, splits them between buses and sets times; crew PINs are generated; QR cards remember what's already printed.
- The bus app opens the school-arrival check when the bus reaches school, and the departure check when it leaves.

## Running it free

Everything runs on free tiers: Supabase Free, Cloudflare Pages, Telegram Bot API, Web Push, OpenFreeMap tiles and Expo EAS free builds. WhatsApp is optional and paid by Meta per message. See docs/SETUP.md.

## Quick local checks

```bash
# database tests (needs a local Postgres 16 on port 5433)
bash supabase/tests/run.sh

# website (all three dashboards)
cd apps/web && npm install && cp .env.example .env.local && npm run dev

# bus app (Android phone with Expo dev build, or build an APK with EAS)
cd apps/bus && npm install && npx expo start
```
