-- =====================================================================
-- UnWay core schema
-- Plain Postgres + pgcrypto (no PostGIS needed: geofencing uses haversine).
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.geo_dist_m(lat1 double precision, lng1 double precision,
                                             lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe as $$
  select case when lat1 is null or lat2 is null or lng1 is null or lng2 is null then null else
    2 * 6371000 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
    )) end
$$;

-- Random code from an unambiguous alphabet (no 0/O/1/I/L)
create or replace function public.random_code(len int) returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(len);
  out text := '';
  i int;
begin
  for i in 0 .. len - 1 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return out;
end $$;

create or replace function public.sha256_hex(t text) returns text language sql immutable as $$
  select encode(extensions.digest(convert_to(t, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          text not null default 'school' check (type in ('school','operator')),
  short_code    text not null unique check (short_code ~ '^[A-Z0-9]{3,6}$'),
  timezone      text not null default 'Asia/Kolkata',
  logo_url      text,
  settings      jsonb not null default '{}'::jsonb,
  staff_join_code text not null default public.random_code(8),
  created_at    timestamptz not null default now()
);

-- Default policy settings (merged with organizations.settings)
create or replace function public.default_settings() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'dup_window_s', 120,
    'late_start_min', 10,
    'overspeed_kmh', 40,
    'allow_bulk_deboard', true,
    'drop_far_m', 300,
    'device_offline_min', 3,
    'channels', jsonb_build_object('whatsapp', false, 'telegram', true, 'webpush', true, 'email', false),
    'approaching_alert', false,
    'staff_telegram_chat_ids', '[]'::jsonb,
    'track_base_url', '',
    'min_app_version', '0.0.0'
  )
$$;

create or replace function public.org_setting(p_org uuid, p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(o.settings -> p_key, public.default_settings() -> p_key)
  from public.organizations o where o.id = p_org
$$;

-- Secrets never exposed through the API (no grants to anon/authenticated)
create table public.org_secrets (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  qr_secret  text not null default encode(extensions.gen_random_bytes(32), 'hex')
);

create table public.campuses (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  name               text not null,
  address            text,
  lat                double precision,
  lng                double precision,
  geofence_radius_m  int not null default 150,
  desk_phone         text,
  created_at         timestamptz not null default now()
);
create index on public.campuses(org_id);

create table public.org_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  role        text not null check (role in ('school_admin','transport_manager','viewer')),
  name        text,
  email       text,
  phone       text,
  created_at  timestamptz not null default now()
);
create index on public.org_users(org_id);

create table public.calendar_days (
  org_id  uuid not null references public.organizations(id) on delete cascade,
  date    date not null,
  type    text not null check (type in ('holiday','half_day','working','exam')),
  note    text,
  primary key (org_id, date)
);

-- ---------------------------------------------------------------------
-- Students & guardians
-- ---------------------------------------------------------------------
create table public.students (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  campus_id          uuid references public.campuses(id) on delete set null,
  public_id          text not null default public.random_code(8),
  cred_version       int  not null default 1,
  admission_no       text,
  first_name         text not null,
  last_name          text not null default '',
  class_name         text,
  section            text,
  dob                date,
  gender             text,
  photo_thumb        text,          -- small JPEG data URL (<= ~15 KB), used offline by bus app
  special_care_note  text check (char_length(special_care_note) <= 60),
  handover_required  boolean not null default false,
  transport_status   text not null default 'active' check (transport_status in ('active','suspended','opted_out','left')),
  opted_in_at        date default current_date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, public_id),
  unique (org_id, admission_no)
);
create index on public.students(org_id, transport_status);
create trigger students_touch before update on public.students for each row execute function public.touch_updated_at();

create table public.credential_history (
  id          bigserial primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  version     int not null,
  issued_at   timestamptz not null default now(),
  issued_by   uuid
);

create table public.guardians (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  relation    text,
  phone       text,                -- E.164 e.g. +919876543210
  email       text,
  language    text not null default 'en' check (language in ('en','hi','te')),
  invite_code text not null unique default public.random_code(10),
  created_at  timestamptz not null default now()
);
create index on public.guardians(org_id);
create index on public.guardians(org_id, phone);

create table public.student_guardians (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  guardian_id  uuid not null references public.guardians(id) on delete cascade,
  is_primary   boolean not null default false,
  notify       boolean not null default true,
  primary key (student_id, guardian_id)
);
create index on public.student_guardians(guardian_id);

create table public.guardian_channels (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  guardian_id      uuid not null references public.guardians(id) on delete cascade,
  channel          text not null check (channel in ('whatsapp','telegram','webpush','email')),
  address          text not null,   -- phone digits / telegram chat id / push subscription JSON / email
  status           text not null default 'active' check (status in ('pending','active','stopped','failed')),
  verified_at      timestamptz,
  last_inbound_at  timestamptz,
  created_at       timestamptz not null default now(),
  unique (guardian_id, channel, address)
);
create index on public.guardian_channels(channel, address);

create table public.consents (
  id           bigserial primary key,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  guardian_id  uuid not null references public.guardians(id) on delete cascade,
  purpose      text not null default 'transport_notifications',
  version      text not null default 'v1',
  channel      text,
  granted_at   timestamptz not null default now(),
  withdrawn_at timestamptz
);

create table public.absences (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  date         date not null,
  legs         text not null default 'BOTH' check (legs in ('AM','PM','BOTH')),
  source       text not null default 'admin',
  note         text,
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz
);
create index on public.absences(org_id, date);
create index on public.absences(student_id, date);

-- ---------------------------------------------------------------------
-- Fleet
-- ---------------------------------------------------------------------
create table public.buses (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  display_number   text not null,
  registration_no  text,
  capacity         int not null default 40,
  status           text not null default 'active' check (status in ('active','maintenance','retired')),
  notes            text,
  created_at       timestamptz not null default now(),
  unique (org_id, display_number)
);

create table public.crew_members (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  name                 text not null,
  role                 text not null check (role in ('driver','attendant')),
  phone                text,
  licence_no           text,
  licence_valid_until  date,
  medical_check_date   date,
  pin_hash             text,   -- sha256(id || ':' || pin)
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);
create index on public.crew_members(org_id);

create table public.bus_crew (
  org_id    uuid not null references public.organizations(id) on delete cascade,
  bus_id    uuid not null references public.buses(id) on delete cascade,
  crew_id   uuid not null references public.crew_members(id) on delete cascade,
  primary key (bus_id, crew_id)
);

create table public.devices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  bus_id         uuid not null references public.buses(id) on delete cascade,
  token_hash     text not null unique,
  model          text,
  os_version     text,
  app_version    text,
  paired_at      timestamptz not null default now(),
  last_seen_at   timestamptz,
  battery        int,
  gps_enabled    boolean,
  pending_queue  int,
  revoked_at     timestamptz
);
create index on public.devices(bus_id) where revoked_at is null;

create table public.pairing_codes (
  code        text primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  bus_id      uuid not null references public.buses(id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_at     timestamptz,
  created_by  uuid
);

create table public.bus_live_state (
  bus_id       uuid primary key references public.buses(id) on delete cascade,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  trip_id      uuid,
  lat          double precision,
  lng          double precision,
  heading      double precision,
  speed_kmh    double precision,
  accuracy_m   double precision,
  battery      int,
  recorded_at  timestamptz,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Routes & stops
-- ---------------------------------------------------------------------
create table public.stops (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  campus_id  uuid references public.campuses(id) on delete set null,
  name       text not null,
  landmark   text,
  lat        double precision not null,
  lng        double precision not null,
  radius_m   int not null default 75,
  created_at timestamptz not null default now()
);
create index on public.stops(org_id);

create table public.routes (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  campus_id        uuid references public.campuses(id) on delete set null,
  code             text not null,
  name             text not null,
  direction        text not null check (direction in ('MORNING','AFTERNOON')),
  default_bus_id   uuid references public.buses(id) on delete set null,
  days_mask        int  not null default 63,   -- bit0=Mon ... bit6=Sun (63 = Mon-Sat)
  scheduled_start  time not null default '07:00',
  active           boolean not null default true,
  path             jsonb,                      -- optional recorded [[lat,lng],...]
  created_at       timestamptz not null default now(),
  unique (org_id, code)
);

create table public.route_stops (
  org_id              uuid not null references public.organizations(id) on delete cascade,
  route_id            uuid not null references public.routes(id) on delete cascade,
  stop_id             uuid not null references public.stops(id) on delete restrict,
  seq                 int  not null,
  planned_offset_min  int  not null default 0,
  primary key (route_id, stop_id)
);
create index on public.route_stops(route_id, seq);

create table public.transport_assignments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  direction       text not null check (direction in ('MORNING','AFTERNOON')),
  route_id        uuid not null references public.routes(id) on delete cascade,
  stop_id         uuid not null references public.stops(id) on delete restrict,
  effective_from  date not null default current_date,
  effective_to    date,
  created_at      timestamptz not null default now()
);
create unique index transport_assignments_one_open on public.transport_assignments(student_id, direction) where effective_to is null;
create index on public.transport_assignments(route_id);

-- ---------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------
create table public.trips (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  route_id           uuid not null references public.routes(id) on delete cascade,
  bus_id             uuid references public.buses(id) on delete set null,
  trip_date          date not null,
  direction          text not null check (direction in ('MORNING','AFTERNOON')),
  status             text not null default 'scheduled'
                     check (status in ('scheduled','active','completed','completed_forced','cancelled','aborted_auto')),
  scheduled_start    timestamptz,
  started_at         timestamptz,
  arrived_at         timestamptz,
  departed_school_at timestamptz,
  completed_at       timestamptz,
  driver_id          uuid references public.crew_members(id) on delete set null,
  attendant_id       uuid references public.crew_members(id) on delete set null,
  device_id          uuid references public.devices(id) on delete set null,
  empty_bus_check    jsonb,
  completion_reason  text,
  created_at         timestamptz not null default now(),
  unique (route_id, trip_date)
);
create index on public.trips(org_id, trip_date);
create index on public.trips(bus_id, trip_date);

create table public.trip_manifest (
  org_id           uuid not null references public.organizations(id) on delete cascade,
  trip_id          uuid not null references public.trips(id) on delete cascade,
  student_id       uuid not null references public.students(id) on delete cascade,
  stop_id          uuid references public.stops(id) on delete set null,
  state            text not null default 'EXPECTED' check (state in
                   ('EXPECTED','ABSENT_NOTIFIED','ON_BOARD','DROPPED','MISSED','NO_SHOW','HANDED_OVER','UNCONFIRMED','TRANSFERRED')),
  state_at         timestamptz not null default now(),
  board_at         timestamptz,
  drop_at          timestamptz,
  resolved_reason  text,
  transferred_to   uuid references public.trips(id) on delete set null,
  is_guest         boolean not null default false,   -- added during trip (wrong-bus allowed / transfer)
  primary key (trip_id, student_id)
);
create index on public.trip_manifest(student_id);

create table public.trip_stop_visits (
  trip_id     uuid not null references public.trips(id) on delete cascade,
  stop_id     uuid not null references public.stops(id) on delete cascade,
  entered_at  timestamptz not null,
  exited_at   timestamptz,
  primary key (trip_id, stop_id)
);

create table public.scan_events (
  id               uuid primary key default gen_random_uuid(),
  client_event_id  text unique,
  org_id           uuid not null references public.organizations(id) on delete cascade,
  trip_id          uuid references public.trips(id) on delete cascade,
  bus_id           uuid references public.buses(id) on delete set null,
  device_id        uuid references public.devices(id) on delete set null,
  student_id       uuid references public.students(id) on delete cascade,
  type             text check (type in ('BOARD','DEBOARD')),
  method           text not null check (method in ('qr','manual','bulk','admin')),
  result           text not null,
  device_ts        timestamptz,
  server_ts        timestamptz not null default now(),
  lat              double precision,
  lng              double precision,
  accuracy_m       double precision,
  stop_id          uuid references public.stops(id) on delete set null,
  crew_id          uuid references public.crew_members(id) on delete set null,
  reason           text,
  raw              text
);
create index on public.scan_events(trip_id, student_id);
create index on public.scan_events(org_id, server_ts);
create index on public.scan_events(student_id, server_ts);

create table public.location_points (
  id          bigserial primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  trip_id     uuid references public.trips(id) on delete cascade,
  bus_id      uuid not null references public.buses(id) on delete cascade,
  ts          timestamptz not null,
  lat         double precision not null,
  lng         double precision not null,
  speed_kmh   double precision,
  heading     double precision,
  accuracy_m  double precision
);
create index on public.location_points(trip_id, ts);
create index on public.location_points(ts);

create table public.exceptions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  trip_id          uuid references public.trips(id) on delete cascade,
  student_id       uuid references public.students(id) on delete cascade,
  bus_id           uuid references public.buses(id) on delete set null,
  code             text not null,
  severity         text not null check (severity in ('info','low','medium','high','critical')),
  status           text not null default 'open' check (status in ('open','acknowledged','resolved')),
  message          text,
  data             jsonb not null default '{}'::jsonb,
  opened_at        timestamptz not null default now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid,
  resolved_at      timestamptz,
  resolved_by      uuid,
  resolution_note  text
);
create unique index exceptions_one_open on public.exceptions
  (coalesce(trip_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(student_id, '00000000-0000-0000-0000-000000000000'::uuid), code)
  where status <> 'resolved';
create index on public.exceptions(org_id, status, opened_at desc);

create table public.incidents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  trip_id          uuid references public.trips(id) on delete set null,
  bus_id           uuid references public.buses(id) on delete set null,
  type             text not null check (type in ('sos_accident','sos_breakdown','sos_medical','sos_security','sos_other','delay','overspeed','long_stop')),
  severity         text not null default 'critical',
  status           text not null default 'open' check (status in ('open','acknowledged','resolved')),
  lat              double precision,
  lng              double precision,
  note             text,
  crew_id          uuid references public.crew_members(id) on delete set null,
  data             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid,
  resolved_at      timestamptz,
  resolution_note  text
);
create index on public.incidents(org_id, status, created_at desc);

-- Idempotency ledger for device events (offline queue replays)
create table public.device_events (
  client_event_id  text primary key,
  device_id        uuid not null references public.devices(id) on delete cascade,
  kind             text not null,
  result           jsonb,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Communications
-- ---------------------------------------------------------------------
create table public.tracking_tokens (
  token        text primary key default public.random_code(20),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  guardian_id  uuid references public.guardians(id) on delete cascade,
  valid_date   date not null,
  created_at   timestamptz not null default now()
);
create unique index tracking_tokens_uniq on public.tracking_tokens(student_id, coalesce(guardian_id,'00000000-0000-0000-0000-000000000000'::uuid), valid_date);

create table public.notification_outbox (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  event_type           text not null,
  dedupe_key           text not null,
  trip_id              uuid references public.trips(id) on delete set null,
  student_id           uuid references public.students(id) on delete cascade,
  guardian_id          uuid references public.guardians(id) on delete cascade,
  recipient_type       text not null default 'guardian' check (recipient_type in ('guardian','staff')),
  channel              text not null check (channel in ('whatsapp','telegram','webpush','email')),
  address              text not null,
  language             text not null default 'en',
  payload              jsonb not null default '{}'::jsonb,
  status               text not null default 'queued' check (status in ('queued','sending','sent','delivered','read','failed','skipped')),
  attempts             int not null default 0,
  next_attempt_at      timestamptz not null default now(),
  provider_message_id  text,
  error                text,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  delivered_at         timestamptz,
  unique (dedupe_key, channel, address)
);
create index on public.notification_outbox(status, next_attempt_at);
create index on public.notification_outbox(org_id, created_at desc);
create index on public.notification_outbox(provider_message_id);

create table public.inbound_messages (
  id            bigserial primary key,
  org_id        uuid references public.organizations(id) on delete cascade,
  channel       text not null,
  from_address  text not null,
  guardian_id   uuid references public.guardians(id) on delete set null,
  body          text,
  command       text,
  created_at    timestamptz not null default now()
);

create table public.audit_log (
  id          bigserial primary key,
  org_id      uuid,
  actor_type  text not null,   -- user / device / system
  actor_id    text,
  action      text not null,
  entity      text,
  entity_id   text,
  data        jsonb,
  created_at  timestamptz not null default now()
);
create index on public.audit_log(org_id, created_at desc);
