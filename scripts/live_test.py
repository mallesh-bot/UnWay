#!/usr/bin/env python3
"""End-to-end smoke test against a deployed UnWay Supabase project.
Env: SB_URL, SB_ANON, SB_SERVICE. Creates a throwaway admin + school, runs a trip,
checks notifications/tracking, then (with --cleanup) deletes everything it created."""
import json, os, sys, time, uuid, urllib.request

URL, ANON, SVC = os.environ["SB_URL"], os.environ["SB_ANON"], os.environ["SB_SERVICE"]
CLEANUP = "--cleanup" in sys.argv

def http(method, path, body=None, key=ANON, bearer=None, headers=None):
    h = {"apikey": key, "Authorization": f"Bearer {bearer or key}", "Content-Type": "application/json", "User-Agent": "unway-test"}
    h.update(headers or {})
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            t = r.read().decode()
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> {e.code}: {e.read().decode()[:500]}")

def rpc(fn, args=None, bearer=None):
    return http("POST", f"/rest/v1/rpc/{fn}", args or {}, bearer=bearer)

def ok(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond: raise SystemExit(1)

email = f"unway-test-{uuid.uuid4().hex[:8]}@example.com"
pw = uuid.uuid4().hex
user = http("POST", "/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True}, key=SVC)
uid = user["id"]
tok = http("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": pw})["access_token"]
print("Admin signed in:", email)
org = None
try:
    code = "T" + uuid.uuid4().hex[:4].upper()
    org = rpc("create_organization", {"p_name": "Live Test School", "p_short_code": code, "p_campus_name": "Main", "p_lat": 17.4400, "p_lng": 78.3800, "p_user_name": "Tester", "p_desk_phone": "+914000000000"}, tok)
    ok(bool(org), "school created")
    demo = rpc("create_demo_data", {}, tok)
    ok(demo["students"] == 16, "demo data created")
    http("PATCH", f"/rest/v1/organizations?id=eq.{org}", {"settings": {"channels": {"telegram": True, "webpush": True}, "track_base_url": "https://example.pages.dev"}}, bearer=tok)

    board = rpc("live_board", {}, tok)
    ok(len(board["buses"]) == 2, f"live board shows {len(board['buses'])} buses, {board['kpi']['scheduled_trips']} scheduled trips")
    buses = http("GET", "/rest/v1/buses?select=id,display_number&order=display_number", bearer=tok)
    bus = buses[0]
    students = http("GET", "/rest/v1/students?select=id,first_name&order=admission_no", bearer=tok)
    creds = rpc("issue_credentials", {"p_student_ids": [s["id"] for s in students]}, tok)
    ok(len(creds) == 16 and creds[0]["payload"].startswith(f"UW1.{code}."), "QR credentials issued")
    qr = {c["student_id"]: c["payload"] for c in creds}

    # a guardian with a Telegram channel (fake chat id) to exercise the dispatcher
    sg = http("GET", f"/rest/v1/student_guardians?select=student_id,guardian_id", bearer=tok)
    pair = rpc("create_pairing_code", {"p_bus_id": bus["id"]}, tok)

    # ---- device
    dev = rpc("dev_pair", {"p_code": pair["code"], "p_info": {"model": "live-test"}})
    dtok = dev["device_token"]
    boot = rpc("dev_bootstrap", {"p_token": dtok})
    trip = next(t for t in boot["trips"] if t["direction"] == "MORNING")
    crew = {c["role"]: c for c in boot["crew"]}
    data = rpc("dev_start_trip", {"p_token": dtok, "p_trip_id": trip["id"], "p_driver_id": crew["driver"]["id"], "p_attendant_id": crew["attendant"]["id"]})
    ok(len(data["manifest"]) == 8, f"trip started, manifest {len(data['manifest'])} children")
    rider = data["manifest"][0]
    guardian = next(x["guardian_id"] for x in sg if x["student_id"] == rider["student_id"])
    http("POST", "/rest/v1/guardian_channels", {"org_id": org, "guardian_id": guardian, "channel": "telegram", "address": "999999999"}, bearer=tok)

    stop = next(s for s in data["stops"] if s["id"] == rider["stop_id"])
    rpc("dev_locations", {"p_token": dtok, "p_trip_id": trip["id"], "p_points": [{"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "lat": stop["lat"], "lng": stop["lng"], "acc": 8, "speed": 3}], "p_battery": 90})
    res = rpc("dev_sync", {"p_token": dtok, "p_events": [
        {"id": str(uuid.uuid4()), "kind": "scan", "trip_id": trip["id"], "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "lat": stop["lat"], "lng": stop["lng"], "data": {"qr": qr[rider["student_id"]], "type": "BOARD"}},
    ]})
    ok(res["results"][0]["result"] == "ok", f"QR scan accepted: {rider['name']} boarded")

    # dispatcher should pick the outbox row up within ~35 s (trigger kick or cron retry)
    status = None
    for _ in range(12):
        time.sleep(5)
        rows = http("GET", f"/rest/v1/notification_outbox?select=status,error,channel,event_type&student_id=eq.{rider['student_id']}", bearer=tok)
        if rows and rows[0]["status"] != "queued":
            status = rows[0]; break
    ok(status is not None, f"dispatcher processed the notification: {status}")

    # tracking snapshot as a parent (anon)
    ttok = http("GET", f"/rest/v1/notification_outbox?select=payload&student_id=eq.{rider['student_id']}", bearer=tok)[0]["payload"]["track_token"]
    snap = rpc("track_snapshot", {"p_token": ttok})
    ok(snap["ok"] and snap["trip"]["state"] == "ON_BOARD", f"parent tracking page sees state {snap['trip']['state']}, live={bool(snap['live'])}")

    # admin-tools function reachable with user JWT
    cfg = http("POST", "/functions/v1/admin-tools", {"action": "config"}, bearer=tok)
    ok("vapid_public_key" in cfg, f"admin-tools config ok (vapid set: {bool(cfg['vapid_public_key'])}, telegram bot: {cfg['telegram_bot']})")

    # anon must not read tables
    try:
        rows = http("GET", "/rest/v1/students?select=id")
        ok(rows == [], "anon sees no students (RLS)")
    except RuntimeError as e:
        ok("401" in str(e) or "42501" in str(e), "anon blocked from students")
    print("LIVE TEST PASSED")
finally:
    if CLEANUP:
        if org:
            from subprocess import run
            run([sys.executable, "/home/claude/.unway/sbsql.py", "-c", f"delete from public.audit_log where org_id = '{org}'; delete from public.organizations where id = '{org}';"], check=False)
        http("DELETE", f"/auth/v1/admin/users/{uid}", key=SVC)
        print("cleaned up test school and user")
