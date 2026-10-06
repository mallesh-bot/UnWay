-- =====================================================================
-- v2: three dashboards (UnWay platform, school, parent) + automation
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Platform (UnWay team) access
-- ---------------------------------------------------------------------
create table if not exists public.platform_admins (
  email     text primary key,
  added_at  timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;
insert into public.platform_admins(email) values ('palukurimallesh@gmail.com') on conflict do nothing;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where email = lower(coalesce(auth.jwt()->>'email', '')))
$$;

-- A platform admin can open any school's dashboard read-only ("view as school").
create table if not exists public.platform_views (
  user_id  uuid primary key,
  org_id   uuid not null references public.organizations(id) on delete cascade,
  started_at timestamptz not null default now()
);
alter table public.platform_views enable row level security;
revoke all on public.platform_views from anon, authenticated;

create or replace function public.my_org() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select org_id from public.org_users where user_id = auth.uid()),
    (select v.org_id from public.platform_views v where v.user_id = auth.uid() and public.is_platform_admin()))
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.org_users where user_id = auth.uid()),
    (select 'viewer' from public.platform_views v where v.user_id = auth.uid() and public.is_platform_admin()))
$$;

-- ---------------------------------------------------------------------
-- 2. New columns
-- ---------------------------------------------------------------------
alter table public.organizations
  add column if not exists status text not null default 'trial' check (status in ('trial','active','suspended')),
  add column if not exists plan text not null default 'pilot',
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists notes text;

alter table public.guardians add column if not exists portal_token text;
update public.guardians set portal_token = public.random_code(24) where portal_token is null;
alter table public.guardians alter column portal_token set default public.random_code(24);
alter table public.guardians alter column portal_token set not null;
create unique index if not exists guardians_portal_token on public.guardians(portal_token);

alter table public.students
  add column if not exists home_lat double precision,
  add column if not exists home_lng double precision,
  add column if not exists home_address text,
  add column if not exists card_printed_at timestamptz;

alter table public.routes add column if not exists auto_planned boolean not null default false;

-- Approaching alerts now on by default (free channels only unless the school opts WhatsApp in)
create or replace function public.default_settings() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'dup_window_s', 120, 'late_start_min', 10, 'overspeed_kmh', 40, 'allow_bulk_deboard', true,
    'drop_far_m', 300, 'device_offline_min', 3,
    'channels', jsonb_build_object('whatsapp', false, 'telegram', true, 'webpush', true, 'email', false),
    'approaching_alert', true, 'approaching_m', 1200, 'approaching_whatsapp', false,
    'auto_whatsapp_invite', true, 'escalate_after_min', 5, 'evening_summary', true, 'learn_stop_times', true,
    'staff_telegram_chat_ids', '[]'::jsonb, 'track_base_url', 'https://unway.pages.dev', 'min_app_version', '0.0.0')
$$;

-- Membership for the web app (works for school staff and platform admins)
create or replace function public.my_membership() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m public.org_users%rowtype; v_view uuid; v_org public.organizations%rowtype;
begin
  if v_uid is null then return null; end if;
  select * into m from public.org_users where user_id = v_uid;
  if m.user_id is null and public.is_platform_admin() then
    select org_id into v_view from public.platform_views where user_id = v_uid;
  end if;
  select * into v_org from public.organizations where id = coalesce(m.org_id, v_view);
  return jsonb_build_object(
    'platform_admin', public.is_platform_admin(),
    'org_id', v_org.id, 'org_status', v_org.status,
    'role', coalesce(m.role, case when v_view is not null then 'viewer' end),
    'viewing_as_platform', m.user_id is null and v_view is not null,
    'name', m.name, 'email', coalesce(m.email, auth.jwt()->>'email'));
end $$;
grant execute on function public.my_membership() to authenticated;

-- Suspended schools: bus phones stop working
create or replace function public._device_auth(p_token text) returns public.devices
language plpgsql security definer set search_path = public as $$
declare d public.devices%rowtype;
begin
  select * into d from public.devices where token_hash = public.sha256_hex(coalesce(p_token, '')) and revoked_at is null;
  if not found then raise exception 'DEVICE_UNAUTHORIZED' using errcode = 'P0001'; end if;
  if exists (select 1 from public.organizations where id = d.org_id and status = 'suspended') then
    raise exception 'ORG_SUSPENDED' using errcode = 'P0001';
  end if;
  update public.devices set last_seen_at = now() where id = d.id;
  return d;
end $$;
revoke all on function public._device_auth(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Notifications: portal link in payloads, approaching alerts skip WhatsApp
-- ---------------------------------------------------------------------
create or replace function public._enqueue_student_event(p_event text, p_trip uuid, p_student uuid,
                                                         p_at timestamptz default now(),
                                                         p_extra jsonb default '{}'::jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_student public.students%rowtype; v_org public.organizations%rowtype; v_trip public.trips%rowtype;
  v_bus text; v_desk text; v_enabled jsonb; v_today date; v_count int := 0; g record; c record;
  v_payload jsonb; v_first boolean; v_wa_ok boolean;
begin
  select * into v_student from public.students where id = p_student;
  if not found then return 0; end if;
  select * into v_org from public.organizations where id = v_student.org_id;
  if v_org.status = 'suspended' then return 0; end if;
  if p_trip is not null then
    select * into v_trip from public.trips where id = p_trip;
    select display_number into v_bus from public.buses where id = v_trip.bus_id;
  end if;
  select coalesce(c2.desk_phone, '') into v_desk from public.campuses c2 where c2.org_id = v_org.id
   order by (c2.id = v_student.campus_id) desc nulls last, c2.created_at limit 1;
  v_enabled := public.org_setting(v_org.id, 'channels');
  v_today := public._org_today(v_org.id);
  v_wa_ok := p_event <> 'APPROACHING' or coalesce((public.org_setting(v_org.id, 'approaching_whatsapp'))::boolean, false);

  for g in select gd.* from public.student_guardians sg join public.guardians gd on gd.id = sg.guardian_id
            where sg.student_id = p_student and sg.notify loop
    v_first := true;
    for c in select gc.* from public.guardian_channels gc
              where gc.guardian_id = g.id and gc.status = 'active'
                and coalesce((v_enabled ->> gc.channel)::boolean, false)
                and (gc.channel <> 'whatsapp' or v_wa_ok)
              order by case gc.channel when 'whatsapp' then 1 when 'telegram' then 2 when 'webpush' then 3 else 4 end, gc.created_at loop
      exit when not v_first and not public._is_critical_event(p_event);
      v_payload := jsonb_build_object(
        'student_first_name', v_student.first_name, 'school', v_org.name, 'bus', coalesce(v_bus, ''),
        'time', public._fmt_time(v_org.id, coalesce(p_at, now())), 'desk_phone', v_desk,
        'track_token', public._tracking_token(v_org.id, p_student, g.id, v_today),
        'portal_token', g.portal_token,
        'track_base_url', public.org_setting(v_org.id, 'track_base_url') #>> '{}',
        'direction', v_trip.direction) || coalesce(p_extra, '{}'::jsonb);
      insert into public.notification_outbox(org_id, event_type, dedupe_key, trip_id, student_id, guardian_id,
                                             recipient_type, channel, address, language, payload)
      values (v_org.id, p_event,
              p_event || ':' || coalesce(p_trip::text, v_today::text) || ':' || p_student::text || coalesce(':' || (p_extra->>'dedupe_suffix'), ''),
              p_trip, p_student, g.id, 'guardian', c.channel, c.address, g.language, v_payload)
      on conflict (dedupe_key, channel, address) do nothing;
      v_count := v_count + 1;
      v_first := false;
    end loop;
  end loop;
  return v_count;
end $$;
revoke all on function public._enqueue_student_event(text, uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;

-- "Bus is about N minutes away" for every child at upcoming stops (called from dev_locations)
create or replace function public._approaching_alerts(p_trip uuid, p_lat double precision, p_lng double precision, p_speed_kmh double precision)
returns int language plpgsql security definer set search_path = public as $$
declare t public.trips%rowtype; s record; r record; v_n int := 0; v_dist double precision; v_limit int; v_speed double precision; v_min int;
begin
  select * into t from public.trips where id = p_trip;
  if t.status <> 'active' or not coalesce((public.org_setting(t.org_id, 'approaching_alert'))::boolean, true) then return 0; end if;
  v_limit := coalesce((public.org_setting(t.org_id, 'approaching_m'))::int, 1200);
  v_speed := greatest(12, least(35, coalesce(nullif(p_speed_kmh, 0), 20)));
  for s in select st.id, st.name, st.lat, st.lng, st.radius_m from public.route_stops rs join public.stops st on st.id = rs.stop_id
            where rs.route_id = t.route_id
              and not exists (select 1 from public.trip_stop_visits v where v.trip_id = t.id and v.stop_id = st.id) loop
    v_dist := public.geo_dist_m(p_lat, p_lng, s.lat, s.lng);
    continue when v_dist > v_limit or v_dist <= s.radius_m;
    v_min := greatest(1, round((v_dist * 1.3 / 1000.0) / v_speed * 60));
    for r in select m.student_id from public.trip_manifest m
              where m.trip_id = t.id and m.stop_id = s.id
                and ((t.direction = 'MORNING' and m.state = 'EXPECTED') or (t.direction = 'AFTERNOON' and m.state = 'ON_BOARD')) loop
      v_n := v_n + public._enqueue_student_event('APPROACHING', t.id, r.student_id, now(),
                jsonb_build_object('stop', s.name, 'minutes', v_min));
    end loop;
  end loop;
  return v_n;
end $$;
revoke all on function public._approaching_alerts(uuid, double precision, double precision, double precision) from public, anon, authenticated;

-- Hook approaching alerts into the location pipeline (wraps the existing function)
alter function public.dev_locations(text, uuid, jsonb, int) rename to _dev_locations_core;
revoke all on function public._dev_locations_core(text, uuid, jsonb, int) from public, anon, authenticated;
create or replace function public.dev_locations(p_token text, p_trip_id uuid, p_points jsonb, p_battery int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_res jsonb; v_last jsonb;
begin
  v_res := public._dev_locations_core(p_token, p_trip_id, p_points, p_battery);
  if p_trip_id is not null then
    select value into v_last from jsonb_array_elements(coalesce(p_points, '[]'::jsonb)) order by (value->>'ts')::timestamptz desc limit 1;
    if v_last is not null and coalesce((v_last->>'acc')::double precision, 0) <= 80 then
      perform public._approaching_alerts(p_trip_id, (v_last->>'lat')::double precision, (v_last->>'lng')::double precision,
                                         (v_last->>'speed')::double precision * 3.6);
    end if;
  end if;
  return v_res;
end $$;
grant execute on function public.dev_locations(text, uuid, jsonb, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. WhatsApp automation: auto-invite guardians, opt-in by replying
-- ---------------------------------------------------------------------
create or replace function public._whatsapp_invite(p_guardian uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare g public.guardians%rowtype; v_school text; v_children text; v_digits text;
begin
  select * into g from public.guardians where id = p_guardian;
  if g.phone is null then return false; end if;
  if not coalesce((public.org_setting(g.org_id, 'channels')->>'whatsapp')::boolean, false)
     or not coalesce((public.org_setting(g.org_id, 'auto_whatsapp_invite'))::boolean, true) then return false; end if;
  v_digits := regexp_replace(g.phone, '\D', '', 'g');
  if exists (select 1 from public.guardian_channels where guardian_id = g.id and channel = 'whatsapp') then return false; end if;
  insert into public.guardian_channels(org_id, guardian_id, channel, address, status)
  values (g.org_id, g.id, 'whatsapp', v_digits, 'pending') on conflict do nothing;
  select name into v_school from public.organizations where id = g.org_id;
  select string_agg(s.first_name, ', ') into v_children from public.student_guardians sg join public.students s on s.id = sg.student_id
   where sg.guardian_id = g.id;
  insert into public.notification_outbox(org_id, event_type, dedupe_key, guardian_id, channel, address, language, payload)
  values (g.org_id, 'WELCOME', 'WELCOME:' || g.id, g.id, 'whatsapp', v_digits, g.language,
          jsonb_build_object('guardian_name', split_part(g.name, ' ', 1), 'school', v_school, 'children', coalesce(v_children, 'your child'),
                             'portal_token', g.portal_token, 'track_base_url', public.org_setting(g.org_id, 'track_base_url') #>> '{}'))
  on conflict do nothing;
  return true;
end $$;
revoke all on function public._whatsapp_invite(uuid) from public, anon, authenticated;

-- invite after a guardian is linked to a child (so the welcome can name the child)
create or replace function public._student_guardian_invite_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._whatsapp_invite(new.guardian_id);
  return null;
end $$;
drop trigger if exists student_guardians_whatsapp_invite on public.student_guardians;
create trigger student_guardians_whatsapp_invite after insert on public.student_guardians
  for each row execute function public._student_guardian_invite_trigger();

create or replace function public.invite_all_whatsapp() returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer(); g record; v_n int := 0;
begin
  for g in select distinct gd.id from public.guardians gd join public.student_guardians sg on sg.guardian_id = gd.id
            where gd.org_id = v_org and gd.phone is not null loop
    if public._whatsapp_invite(g.id) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
grant execute on function public.invite_all_whatsapp() to authenticated;

-- Inbound parent messages: recognise unknown WhatsApp numbers by phone, JOIN <code>, LINK/MENU
create or replace function public.svc_guardian_command(p_channel text, p_address text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cmd text; v_arg text; v_words text[]; g record; v_out jsonb := '[]'::jsonb; v_date date; v_legs text;
  v_found boolean := false; v_lang text := 'en'; s record; v_status jsonb; v_desk text; v_today date; gx record;
begin
  v_words := regexp_split_to_array(upper(trim(coalesce(p_text, ''))), '\s+');
  v_cmd := replace(v_words[1], '/', '');
  v_arg := array_to_string(v_words[2:], ' ');

  -- WhatsApp: JOIN <invite code> links this number; otherwise a message from a known guardian phone opts them in
  if p_channel = 'whatsapp' then
    if v_cmd = 'JOIN' and v_arg <> '' then
      for gx in select * from public.guardians where invite_code = split_part(v_arg, ' ', 1) loop
        insert into public.guardian_channels(org_id, guardian_id, channel, address, status, verified_at)
        values (gx.org_id, gx.id, 'whatsapp', regexp_replace(p_address, '\D', '', 'g'), 'active', now())
        on conflict (guardian_id, channel, address) do update set status = 'active', verified_at = now();
        insert into public.consents(org_id, guardian_id, channel) values (gx.org_id, gx.id, 'whatsapp');
      end loop;
      v_cmd := 'START';
    elsif not exists (select 1 from public.guardian_channels where channel = 'whatsapp'
                       and regexp_replace(address, '\D', '', 'g') = regexp_replace(p_address, '\D', '', 'g')) then
      for gx in select * from public.guardians where phone is not null
                 and right(regexp_replace(phone, '\D', '', 'g'), 10) = right(regexp_replace(p_address, '\D', '', 'g'), 10) loop
        insert into public.guardian_channels(org_id, guardian_id, channel, address, status, verified_at)
        values (gx.org_id, gx.id, 'whatsapp', regexp_replace(p_address, '\D', '', 'g'), 'active', now())
        on conflict do nothing;
        insert into public.consents(org_id, guardian_id, channel) values (gx.org_id, gx.id, 'whatsapp');
      end loop;
    end if;
  end if;

  for g in
    select gd.*, gc.id as channel_id from public.guardian_channels gc join public.guardians gd on gd.id = gc.guardian_id
     where gc.channel = p_channel
       and (gc.address = p_address or (p_channel = 'whatsapp' and regexp_replace(gc.address, '\D', '', 'g') = regexp_replace(p_address, '\D', '', 'g')))
  loop
    v_found := true; v_lang := g.language;
    update public.guardian_channels set last_inbound_at = now(),
           status = case when status = 'pending' and v_cmd not in ('STOP','UNSUBSCRIBE') then 'active' else status end
     where id = g.channel_id;
    insert into public.inbound_messages(org_id, channel, from_address, guardian_id, body, command)
    values (g.org_id, p_channel, p_address, g.id, left(p_text, 500), v_cmd);
    v_today := public._org_today(g.org_id);
    select desk_phone into v_desk from public.campuses where org_id = g.org_id order by created_at limit 1;

    if v_cmd in ('STOP','UNSUBSCRIBE') then
      update public.guardian_channels set status = 'stopped' where id = g.channel_id;
      update public.consents set withdrawn_at = now() where guardian_id = g.id and channel = p_channel and withdrawn_at is null;
      v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'stopped'));
    elsif v_cmd in ('START','YES','JOIN','HI','HELLO') then
      update public.guardian_channels set status = 'active', verified_at = coalesce(verified_at, now()) where id = g.channel_id;
      insert into public.consents(org_id, guardian_id, channel) values (g.org_id, g.id, p_channel);
      v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'started',
        'portal_url', nullif(public.org_setting(g.org_id, 'track_base_url') #>> '{}', '') || '/p/' || g.portal_token));
    elsif v_cmd in ('LINK','MENU','DASHBOARD','APP') then
      v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'portal',
        'portal_url', nullif(public.org_setting(g.org_id, 'track_base_url') #>> '{}', '') || '/p/' || g.portal_token));
    elsif v_cmd = 'ABSENT' then
      v_date := case when v_arg like '%TODAY%' then v_today else v_today + 1 end;
      v_legs := case when v_arg like '%AM%' or v_arg like '%MORNING%' then 'AM'
                     when v_arg like '%PM%' or v_arg like '%EVENING%' or v_arg like '%AFTERNOON%' then 'PM' else 'BOTH' end;
      for s in select st.id, st.first_name from public.student_guardians sg join public.students st on st.id = sg.student_id
                where sg.guardian_id = g.id and st.transport_status = 'active' loop
        insert into public.absences(org_id, student_id, date, legs, source) values (g.org_id, s.id, v_date, v_legs, 'parent_' || p_channel);
        update public.trip_manifest m set state = 'ABSENT_NOTIFIED', state_at = now(), resolved_reason = 'parent: absent'
          from public.trips t
         where m.trip_id = t.id and m.student_id = s.id and t.trip_date = v_date and m.state = 'EXPECTED'
           and (v_legs = 'BOTH' or (v_legs = 'AM' and t.direction = 'MORNING') or (v_legs = 'PM' and t.direction = 'AFTERNOON'));
        v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'absent', 'child', s.first_name, 'date', v_date, 'legs', v_legs));
      end loop;
    elsif v_cmd in ('STATUS','WHERE') then
      for s in select st.id, st.first_name from public.student_guardians sg join public.students st on st.id = sg.student_id
                where sg.guardian_id = g.id loop
        select jsonb_build_object('type', 'status', 'child', s.first_name, 'direction', t.direction, 'state', m.state,
                                  'bus', b.display_number, 'board_at', public._fmt_time(g.org_id, m.board_at),
                                  'drop_at', public._fmt_time(g.org_id, m.drop_at),
                                  'track_token', public._tracking_token(g.org_id, s.id, g.id, v_today),
                                  'track_base_url', public.org_setting(g.org_id, 'track_base_url') #>> '{}')
          into v_status
          from public.trip_manifest m join public.trips t on t.id = m.trip_id left join public.buses b on b.id = t.bus_id
         where m.student_id = s.id and t.trip_date = v_today and m.state <> 'TRANSFERRED'
         order by (t.status = 'active') desc, t.scheduled_start desc limit 1;
        v_out := v_out || jsonb_build_array(coalesce(v_status, jsonb_build_object('type', 'status', 'child', s.first_name, 'state', 'NO_TRIP')));
      end loop;
      v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'portal',
        'portal_url', nullif(public.org_setting(g.org_id, 'track_base_url') #>> '{}', '') || '/p/' || g.portal_token));
    else
      v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'help', 'desk_phone', v_desk));
    end if;
  end loop;

  if not v_found then
    insert into public.inbound_messages(channel, from_address, body, command) values (p_channel, p_address, left(p_text, 500), v_cmd);
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_SENDER', 'language', v_lang);
  end if;
  return jsonb_build_object('ok', true, 'language', v_lang, 'items', v_out);
end $$;
revoke all on function public.svc_guardian_command(text, text, text) from public, anon, authenticated;
grant execute on function public.svc_guardian_command(text, text, text) to service_role;

-- Telegram link reply includes the parent dashboard link
create or replace function public.svc_link_telegram(p_invite_code text, p_chat_id text, p_display text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.guardians%rowtype; v_school text; v_children text;
begin
  select * into g from public.guardians where invite_code = upper(trim(p_invite_code));
  if not found then return jsonb_build_object('ok', false, 'code', 'INVALID_CODE'); end if;
  insert into public.guardian_channels(org_id, guardian_id, channel, address, status, verified_at, last_inbound_at)
  values (g.org_id, g.id, 'telegram', p_chat_id, 'active', now(), now())
  on conflict (guardian_id, channel, address) do update set status = 'active', verified_at = now(), last_inbound_at = now();
  insert into public.consents(org_id, guardian_id, channel) values (g.org_id, g.id, 'telegram');
  select name into v_school from public.organizations where id = g.org_id;
  select string_agg(s.first_name, ', ') into v_children from public.student_guardians sg join public.students s on s.id = sg.student_id
   where sg.guardian_id = g.id;
  return jsonb_build_object('ok', true, 'guardian', g.name, 'school', v_school, 'children', coalesce(v_children, ''), 'language', g.language,
    'portal_url', nullif(public.org_setting(g.org_id, 'track_base_url') #>> '{}', '') || '/p/' || g.portal_token);
end $$;
revoke all on function public.svc_link_telegram(text, text, text) from public, anon, authenticated;
grant execute on function public.svc_link_telegram(text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 5. Parent dashboard API (personal link token, no password)
-- ---------------------------------------------------------------------
create or replace function public._guardian_by_portal(p_token text) returns public.guardians
language plpgsql stable security definer set search_path = public as $$
declare g public.guardians%rowtype;
begin
  select * into g from public.guardians where portal_token = p_token;
  if not found or length(coalesce(p_token, '')) < 20 then raise exception 'INVALID_LINK' using errcode = 'P0001'; end if;
  return g;
end $$;
revoke all on function public._guardian_by_portal(text) from public, anon, authenticated;

create or replace function public._guardian_has_student(p_guardian uuid, p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.student_guardians where guardian_id = p_guardian and student_id = p_student)
$$;
revoke all on function public._guardian_has_student(uuid, uuid) from public, anon, authenticated;

create or replace function public.parent_portal(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.guardians%rowtype; o public.organizations%rowtype; v_today date; v_children jsonb; v_campus jsonb;
begin
  g := public._guardian_by_portal(p_token);
  select * into o from public.organizations where id = g.org_id;
  v_today := public._org_today(o.id);
  select jsonb_build_object('name', c.name, 'desk_phone', c.desk_phone, 'lat', c.lat, 'lng', c.lng)
    into v_campus from public.campuses c where c.org_id = o.id order by c.created_at limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'first_name', s.first_name, 'last_name', s.last_name,
    'class', concat_ws('-', s.class_name, s.section), 'photo', s.photo_thumb, 'transport_status', s.transport_status,
    'track_token', public._tracking_token(o.id, s.id, g.id, v_today),
    'routes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'direction', a.direction, 'route', r.code, 'bus', b.display_number, 'stop', st.name,
                  'stop_lat', st.lat, 'stop_lng', st.lng,
                  'time', to_char((current_date + r.scheduled_start + make_interval(mins => rs.planned_offset_min))::time, 'FMHH12:MI AM'))
                  order by a.direction desc), '[]'::jsonb)
               from public.transport_assignments a
               join public.routes r on r.id = a.route_id
               left join public.buses b on b.id = r.default_bus_id
               join public.stops st on st.id = a.stop_id
               left join public.route_stops rs on rs.route_id = r.id and rs.stop_id = a.stop_id
              where a.student_id = s.id and a.effective_to is null),
    'today', (select coalesce(jsonb_agg(jsonb_build_object(
                  'direction', t.direction, 'state', m.state, 'board_at', m.board_at, 'drop_at', m.drop_at,
                  'bus', b.display_number, 'trip_status', t.status, 'reason', m.resolved_reason) order by t.scheduled_start), '[]'::jsonb)
               from public.trip_manifest m join public.trips t on t.id = m.trip_id left join public.buses b on b.id = t.bus_id
              where m.student_id = s.id and t.trip_date = v_today and m.state <> 'TRANSFERRED'),
    'absences', (select coalesce(jsonb_agg(jsonb_build_object('id', ab.id, 'date', ab.date, 'legs', ab.legs, 'source', ab.source) order by ab.date), '[]'::jsonb)
                  from public.absences ab where ab.student_id = s.id and ab.date >= v_today and ab.cancelled_at is null),
    'stats', (select jsonb_build_object(
                 'rides', count(*) filter (where m.state in ('DROPPED','HANDED_OVER')),
                 'missed', count(*) filter (where m.state = 'MISSED'),
                 'absent', count(*) filter (where m.state = 'ABSENT_NOTIFIED'),
                 'days', count(distinct t.trip_date))
               from public.trip_manifest m join public.trips t on t.id = m.trip_id
              where m.student_id = s.id and t.trip_date > v_today - 30)
  ) order by s.first_name), '[]'::jsonb)
  into v_children
  from public.student_guardians sg join public.students s on s.id = sg.student_id
  where sg.guardian_id = g.id;

  return jsonb_build_object(
    'guardian', jsonb_build_object('name', g.name, 'language', g.language, 'phone', g.phone, 'invite_code', g.invite_code,
       'channels', (select coalesce(jsonb_agg(jsonb_build_object('channel', gc.channel, 'status', gc.status)), '[]'::jsonb)
                      from public.guardian_channels gc where gc.guardian_id = g.id)),
    'school', jsonb_build_object('name', o.name, 'campus', v_campus,
       'channels', public.org_setting(o.id, 'channels')),
    'today', v_today, 'children', v_children, 'server_ts', now());
end $$;

create or replace function public.parent_history(p_token text, p_student uuid, p_days int default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.guardians%rowtype; v_today date;
begin
  g := public._guardian_by_portal(p_token);
  if not public._guardian_has_student(g.id, p_student) then raise exception 'NOT_YOUR_CHILD' using errcode = 'P0001'; end if;
  v_today := public._org_today(g.org_id);
  return (select coalesce(jsonb_agg(day order by (day->>'date') desc), '[]'::jsonb) from (
    select jsonb_build_object('date', t.trip_date, 'legs', jsonb_agg(jsonb_build_object(
             'direction', t.direction, 'state', m.state, 'board_at', m.board_at, 'drop_at', m.drop_at, 'bus', b.display_number,
             'stop', st.name) order by t.scheduled_start)) as day
      from public.trip_manifest m join public.trips t on t.id = m.trip_id
      left join public.buses b on b.id = t.bus_id left join public.stops st on st.id = m.stop_id
     where m.student_id = p_student and t.trip_date between v_today - least(greatest(p_days, 1), 120) and v_today
       and m.state <> 'TRANSFERRED'
     group by t.trip_date) x);
end $$;

create or replace function public.parent_set_absence(p_token text, p_student uuid, p_date date, p_legs text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.guardians%rowtype; v_id uuid; v_today date;
begin
  g := public._guardian_by_portal(p_token);
  if not public._guardian_has_student(g.id, p_student) then raise exception 'NOT_YOUR_CHILD' using errcode = 'P0001'; end if;
  v_today := public._org_today(g.org_id);
  if p_date < v_today or p_date > v_today + 90 then raise exception 'DATE_OUT_OF_RANGE' using errcode = 'P0001'; end if;
  if p_legs not in ('AM','PM','BOTH') then raise exception 'BAD_LEGS' using errcode = 'P0001'; end if;
  insert into public.absences(org_id, student_id, date, legs, source) values (g.org_id, p_student, p_date, p_legs, 'parent_portal')
  returning id into v_id;
  update public.trip_manifest m set state = 'ABSENT_NOTIFIED', state_at = now(), resolved_reason = 'parent: absent'
    from public.trips t
   where m.trip_id = t.id and m.student_id = p_student and t.trip_date = p_date and m.state = 'EXPECTED'
     and (p_legs = 'BOTH' or (p_legs = 'AM' and t.direction = 'MORNING') or (p_legs = 'PM' and t.direction = 'AFTERNOON'));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.parent_cancel_absence(p_token text, p_absence uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.guardians%rowtype; a public.absences%rowtype;
begin
  g := public._guardian_by_portal(p_token);
  select * into a from public.absences where id = p_absence;
  if not found or not public._guardian_has_student(g.id, a.student_id) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  update public.absences set cancelled_at = now() where id = p_absence;
  update public.trip_manifest m set state = 'EXPECTED', state_at = now(), resolved_reason = null
    from public.trips t
   where m.trip_id = t.id and m.student_id = a.student_id and t.trip_date = a.date and m.state = 'ABSENT_NOTIFIED' and t.status <> 'completed';
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.parent_set_preferences(p_token text, p_language text default null, p_paused_channel text default null, p_paused boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.guardians%rowtype;
begin
  g := public._guardian_by_portal(p_token);
  if p_language in ('en','hi','te') then update public.guardians set language = p_language where id = g.id; end if;
  if p_paused_channel is not null and p_paused is not null then
    update public.guardian_channels set status = case when p_paused then 'stopped' else 'active' end
     where guardian_id = g.id and channel = p_paused_channel and status in ('active','stopped');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.parent_webpush_subscribe(p_token text, p_subscription jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.guardians%rowtype;
begin
  g := public._guardian_by_portal(p_token);
  return public.webpush_subscribe(g.invite_code, p_subscription);
end $$;

grant execute on function public.parent_portal(text), public.parent_history(text, uuid, int),
  public.parent_set_absence(text, uuid, date, text), public.parent_cancel_absence(text, uuid),
  public.parent_set_preferences(text, text, text, boolean), public.parent_webpush_subscribe(text, jsonb)
  to anon, authenticated;

-- join page also returns the portal link so new parents land on their dashboard
create or replace function public.join_info(p_invite_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when g.id is null then jsonb_build_object('ok', false) else jsonb_build_object(
    'ok', true, 'guardian', split_part(g.name, ' ', 1), 'school', o.name, 'language', g.language,
    'portal_token', g.portal_token,
    'children', (select coalesce(jsonb_agg(s.first_name), '[]'::jsonb) from public.student_guardians sg
                   join public.students s on s.id = sg.student_id where sg.guardian_id = g.id),
    'channels', (select coalesce(jsonb_agg(distinct gc.channel), '[]'::jsonb) from public.guardian_channels gc
                   where gc.guardian_id = g.id and gc.status = 'active')) end
  from (select 1) x
  left join public.guardians g on g.invite_code = upper(p_invite_code)
  left join public.organizations o on o.id = g.org_id
$$;

-- ---------------------------------------------------------------------
-- 6. School dashboard: setup checklist, trends, route plan apply
-- ---------------------------------------------------------------------
create or replace function public.setup_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.my_org(); c public.campuses%rowtype;
begin
  if v_org is null then raise exception 'NOT_IN_ORGANIZATION' using errcode = '42501'; end if;
  select * into c from public.campuses where org_id = v_org order by created_at limit 1;
  return jsonb_build_object(
    'school_location', c.lat is not null,
    'desk_phone', coalesce(c.desk_phone, '') <> '',
    'buses', (select count(*) from public.buses where org_id = v_org and status <> 'retired'),
    'crew', (select count(*) from public.crew_members where org_id = v_org and active),
    'crew_without_pin', (select count(*) from public.crew_members where org_id = v_org and active and pin_hash is null),
    'students', (select count(*) from public.students where org_id = v_org and transport_status = 'active'),
    'students_with_home', (select count(*) from public.students where org_id = v_org and transport_status = 'active' and home_lat is not null),
    'students_assigned', (select count(distinct a.student_id) from public.transport_assignments a join public.students s on s.id = a.student_id
                            where a.org_id = v_org and a.effective_to is null and s.transport_status = 'active'),
    'routes', (select count(*) from public.routes where org_id = v_org and active),
    'cards_unprinted', (select count(*) from public.students where org_id = v_org and transport_status = 'active' and card_printed_at is null),
    'guardians', (select count(*) from public.guardians where org_id = v_org),
    'guardians_connected', (select count(distinct guardian_id) from public.guardian_channels where org_id = v_org and status = 'active'),
    'buses_paired', (select count(distinct bus_id) from public.devices where org_id = v_org and revoked_at is null),
    'staff_alerts', jsonb_array_length(coalesce(public.org_setting(v_org, 'staff_telegram_chat_ids'), '[]'::jsonb)) > 0,
    'track_base_url', coalesce(public.org_setting(v_org, 'track_base_url') #>> '{}', '') <> '');
end $$;
grant execute on function public.setup_status() to authenticated;

create or replace function public.school_trends(p_days int default 14) returns table(
  day date, trips bigint, completed bigint, on_time_pct numeric, riders bigint, missed bigint, exceptions bigint, messages bigint)
language sql stable security definer set search_path = public as $$
  with days as (
    select generate_series(public._org_today(public.my_org()) - (least(greatest(p_days,1),60) - 1), public._org_today(public.my_org()), interval '1 day')::date as d
  )
  select d.d,
    (select count(*) from public.trips t where t.org_id = public.my_org() and t.trip_date = d.d and t.status <> 'cancelled'),
    (select count(*) from public.trips t where t.org_id = public.my_org() and t.trip_date = d.d and t.status in ('completed','completed_forced')),
    (select round(100.0 * count(*) filter (where t.started_at <= t.scheduled_start + interval '10 minutes') / nullif(count(*) filter (where t.started_at is not null), 0), 0)
       from public.trips t where t.org_id = public.my_org() and t.trip_date = d.d),
    (select count(*) from public.trip_manifest m join public.trips t on t.id = m.trip_id
      where t.org_id = public.my_org() and t.trip_date = d.d and m.state in ('DROPPED','HANDED_OVER','ON_BOARD')),
    (select count(*) from public.trip_manifest m join public.trips t on t.id = m.trip_id
      where t.org_id = public.my_org() and t.trip_date = d.d and m.state in ('MISSED','UNCONFIRMED')),
    (select count(*) from public.exceptions x join public.trips t on t.id = x.trip_id where t.org_id = public.my_org() and t.trip_date = d.d),
    (select count(*) from public.notification_outbox o where o.org_id = public.my_org() and o.status in ('sent','delivered','read')
       and (o.created_at at time zone 'Asia/Kolkata')::date = d.d)
  from days d order by d.d
$$;
grant execute on function public.school_trends(int) to authenticated;

-- Applies an automatically planned set of routes in one transaction.
-- plan = { stops: [{key, name, lat, lng, radius_m}],
--          routes: [{bus_id, code, name, am_start "07:00", pm_start "15:00",
--                    stops: [{key, offset_min}]  (morning order, last stop nearest school),
--                    students: [{student_id, stop_key}] }] }
create or replace function public.apply_route_plan(p_plan jsonb, p_replace boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public._require_writer(); v_today date; v_campus uuid; s jsonb; r jsonb; st jsonb; x jsonb;
  v_keys jsonb := '{}'::jsonb; v_id uuid; v_am uuid; v_pm uuid; v_code text; v_n int; v_total int; v_routes int := 0; v_students int := 0; i int;
begin
  v_today := public._org_today(v_org);
  select id into v_campus from public.campuses where org_id = v_org order by created_at limit 1;
  if p_replace then
    update public.trips set status = 'cancelled', completion_reason = 'Routes re-planned'
     where org_id = v_org and status = 'scheduled' and trip_date >= v_today
       and route_id in (select id from public.routes where org_id = v_org and active);
    update public.routes set active = false where org_id = v_org and active;
    delete from public.transport_assignments where org_id = v_org and effective_to is null and effective_from >= v_today;
    update public.transport_assignments set effective_to = v_today - 1 where org_id = v_org and effective_to is null;
  end if;

  for s in select * from jsonb_array_elements(p_plan->'stops') loop
    insert into public.stops(org_id, campus_id, name, lat, lng, radius_m)
    values (v_org, v_campus, left(coalesce(nullif(s->>'name',''), 'Stop'), 80), (s->>'lat')::double precision, (s->>'lng')::double precision,
            coalesce((s->>'radius_m')::int, 80))
    returning id into v_id;
    v_keys := v_keys || jsonb_build_object(s->>'key', v_id);
  end loop;

  for r in select * from jsonb_array_elements(p_plan->'routes') loop
    v_code := upper(coalesce(nullif(r->>'code',''), 'R'));
    v_n := 1;
    while exists (select 1 from public.routes where org_id = v_org and code in (v_code, v_code || '-PM')) loop
      v_n := v_n + 1; v_code := upper(coalesce(nullif(r->>'code',''), 'R')) || '.' || v_n;
    end loop;
    insert into public.routes(org_id, campus_id, code, name, direction, default_bus_id, days_mask, scheduled_start, auto_planned)
    values (v_org, v_campus, v_code, coalesce(r->>'name', v_code), 'MORNING', nullif(r->>'bus_id','')::uuid, 63,
            coalesce(nullif(r->>'am_start','')::time, '07:00'), true) returning id into v_am;
    insert into public.routes(org_id, campus_id, code, name, direction, default_bus_id, days_mask, scheduled_start, auto_planned)
    values (v_org, v_campus, v_code || '-PM', coalesce(r->>'name', v_code) || ' (home)', 'AFTERNOON', nullif(r->>'bus_id','')::uuid, 63,
            coalesce(nullif(r->>'pm_start','')::time, '15:00'), true) returning id into v_pm;
    v_routes := v_routes + 1;
    v_total := coalesce((select max((e->>'offset_min')::int) from jsonb_array_elements(r->'stops') e), 0);
    i := 0;
    for st in select * from jsonb_array_elements(r->'stops') loop
      i := i + 1;
      insert into public.route_stops(org_id, route_id, stop_id, seq, planned_offset_min)
      values (v_org, v_am, (v_keys->>(st->>'key'))::uuid, i, coalesce((st->>'offset_min')::int, 0));
    end loop;
    -- afternoon: reverse order, time measured from leaving school
    i := 0;
    for st in select value from jsonb_array_elements(r->'stops') with ordinality e(value, ord) order by ord desc loop
      i := i + 1;
      insert into public.route_stops(org_id, route_id, stop_id, seq, planned_offset_min)
      values (v_org, v_pm, (v_keys->>(st->>'key'))::uuid, i, greatest(0, v_total - coalesce((st->>'offset_min')::int, 0)) + 5);
    end loop;
    for x in select * from jsonb_array_elements(r->'students') loop
      delete from public.transport_assignments where student_id = (x->>'student_id')::uuid and effective_to is null;
      insert into public.transport_assignments(org_id, student_id, direction, route_id, stop_id, effective_from) values
        (v_org, (x->>'student_id')::uuid, 'MORNING', v_am, (v_keys->>(x->>'stop_key'))::uuid, v_today),
        (v_org, (x->>'student_id')::uuid, 'AFTERNOON', v_pm, (v_keys->>(x->>'stop_key'))::uuid, v_today);
      v_students := v_students + 1;
    end loop;
  end loop;
  perform public.generate_trips_for_org(v_org, v_today);
  perform public.generate_trips_for_org(v_org, v_today + 1);
  perform public._audit(v_org, 'user', auth.uid()::text, 'routes_auto_planned', 'routes', null,
                        jsonb_build_object('routes', v_routes, 'students', v_students, 'replace', p_replace));
  return jsonb_build_object('ok', true, 'routes', v_routes, 'students', v_students);
end $$;
grant execute on function public.apply_route_plan(jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Scheduled automation: escalation, evening summary, learned stop times
-- ---------------------------------------------------------------------
create or replace function public._escalate() returns int
language plpgsql security definer set search_path = public as $$
declare x record; v_n int := 0; v_bus text;
begin
  for x in select e.* from public.exceptions e join public.organizations o on o.id = e.org_id
            where e.status = 'open' and e.severity in ('high','critical') and not (e.data ? 'escalated_at')
              and e.opened_at < now() - make_interval(mins => coalesce((public.org_setting(e.org_id, 'escalate_after_min'))::int, 5))
              and e.opened_at > now() - interval '6 hours' loop
    select display_number into v_bus from public.buses where id = x.bus_id;
    perform public._enqueue_staff(x.org_id, 'ESCALATION', x.id::text, jsonb_build_object(
      'bus', coalesce(v_bus, '-'), 'message', coalesce(x.message, x.code),
      'minutes', round(extract(epoch from now() - x.opened_at) / 60)));
    update public.exceptions set data = data || jsonb_build_object('escalated_at', now()) where id = x.id;
    v_n := v_n + 1;
  end loop;
  -- SOS not acknowledged within 3 minutes: alert staff again
  for x in select i.* from public.incidents i where i.status = 'open' and i.type like 'sos%' and not (i.data ? 'escalated_at')
              and i.created_at < now() - interval '3 minutes' and i.created_at > now() - interval '6 hours' loop
    select display_number into v_bus from public.buses where id = x.bus_id;
    perform public._enqueue_staff(x.org_id, 'ESCALATION', 'sos:' || x.id, jsonb_build_object(
      'bus', coalesce(v_bus, '-'), 'message', 'SOS ' || replace(x.type, 'sos_', '') || ' still not acknowledged',
      'minutes', round(extract(epoch from now() - x.created_at) / 60)));
    update public.incidents set data = data || jsonb_build_object('escalated_at', now()) where id = x.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.cron_minutely() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_n_late int := 0; v_n_off int := 0; v_n_closed int := 0; v_esc int;
begin
  for r in select t.*, b.display_number, rt.code as route_code from public.trips t
             join public.routes rt on rt.id = t.route_id left join public.buses b on b.id = t.bus_id
            where t.status = 'scheduled' and t.trip_date = public._org_today(t.org_id)
              and t.scheduled_start < now() - make_interval(mins => coalesce((public.org_setting(t.org_id,'late_start_min'))::int, 10))
              and t.scheduled_start > now() - interval '3 hours' loop
    if public._raise_exception(r.org_id, r.id, null, r.bus_id, 'TRIP_LATE_START', 'medium',
         'Bus ' || coalesce(r.display_number,'?') || ' (' || r.route_code || ') has not started', '{}'::jsonb) is not null then
      v_n_late := v_n_late + 1;
    end if;
  end loop;
  for r in select t.*, b.display_number from public.trips t
             left join public.buses b on b.id = t.bus_id left join public.bus_live_state l on l.bus_id = t.bus_id
            where t.status = 'active'
              and coalesce(l.updated_at, t.started_at) < now() - make_interval(mins => coalesce((public.org_setting(t.org_id,'device_offline_min'))::int, 3)) loop
    perform public._raise_exception(r.org_id, r.id, null, r.bus_id, 'DEVICE_OFFLINE', 'high',
       'No location from Bus ' || coalesce(r.display_number,'?') || ' for several minutes', '{}'::jsonb);
    v_n_off := v_n_off + 1;
  end loop;
  for r in select t.* from public.trips t join public.organizations o on o.id = t.org_id
            where t.status = 'active'
              and (t.trip_date < (now() at time zone o.timezone)::date or (now() at time zone o.timezone)::time > time '23:00') loop
    update public.trip_manifest set state = 'UNCONFIRMED', state_at = now(), resolved_reason = 'trip auto-closed' where trip_id = r.id and state = 'ON_BOARD';
    update public.trip_manifest set state = 'NO_SHOW', state_at = now(), resolved_reason = 'trip auto-closed' where trip_id = r.id and state = 'EXPECTED';
    update public.trips set status = 'aborted_auto', completed_at = now(), completion_reason = 'Not completed by crew' where id = r.id;
    if r.empty_bus_check is null or exists (select 1 from public.trip_manifest where trip_id = r.id and state = 'UNCONFIRMED') then
      perform public._raise_exception(r.org_id, r.id, null, r.bus_id, 'CHILD_LEFT_ON_BUS_RISK', 'critical',
         'Trip was never completed and the Empty Bus Check is missing. Check the bus now.', '{}'::jsonb);
    end if;
    v_n_closed := v_n_closed + 1;
  end loop;
  v_esc := public._escalate();
  return jsonb_build_object('late', v_n_late, 'offline', v_n_off, 'auto_closed', v_n_closed, 'escalated', v_esc);
end $$;

create or replace function public.cron_evening() returns int
language plpgsql security definer set search_path = public as $$
declare o record; v_today date; v_n int := 0; p jsonb;
begin
  for o in select * from public.organizations where status <> 'suspended' loop
    continue when not coalesce((public.org_setting(o.id, 'evening_summary'))::boolean, true);
    v_today := public._org_today(o.id);
    continue when not exists (select 1 from public.trips where org_id = o.id and trip_date = v_today and status <> 'cancelled');
    select jsonb_build_object(
      'school', o.name, 'date', to_char(v_today, 'DD Mon'),
      'trips', count(*) filter (where t.status <> 'cancelled'),
      'completed', count(*) filter (where t.status in ('completed','completed_forced')),
      'not_completed', count(*) filter (where t.status in ('active','aborted_auto')),
      'late_starts', count(*) filter (where t.started_at > t.scheduled_start + interval '10 minutes'),
      'riders', (select count(*) from public.trip_manifest m join public.trips t2 on t2.id = m.trip_id
                  where t2.org_id = o.id and t2.trip_date = v_today and m.state in ('DROPPED','HANDED_OVER')),
      'missed', (select count(*) from public.trip_manifest m join public.trips t2 on t2.id = m.trip_id
                  where t2.org_id = o.id and t2.trip_date = v_today and m.state in ('MISSED','UNCONFIRMED')),
      'open_exceptions', (select count(*) from public.exceptions where org_id = o.id and status <> 'resolved'),
      'messages', (select count(*) from public.notification_outbox where org_id = o.id and status in ('sent','delivered','read')
                    and (created_at at time zone o.timezone)::date = v_today))
      into p from public.trips t where t.org_id = o.id and t.trip_date = v_today;
    v_n := v_n + public._enqueue_staff(o.id, 'DAILY_SUMMARY', o.id || ':' || v_today, p);
  end loop;
  return v_n;
end $$;

create or replace function public.cron_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_trips int := 0; v_learned int := 0;
begin
  for r in select id from public.organizations where status <> 'suspended' loop
    v_trips := v_trips + public.generate_trips_for_org(r.id, public._org_today(r.id));
    v_trips := v_trips + public.generate_trips_for_org(r.id, public._org_today(r.id) + 1);
  end loop;
  -- learn real stop times: median minutes from trip start to arrival over the last 15 trips (>= 3 samples)
  with samples as (
    select rs.route_id, rs.stop_id, rs.planned_offset_min,
           percentile_cont(0.5) within group (order by extract(epoch from v.entered_at - t.started_at) / 60) as med, count(*) as n
      from public.route_stops rs
      join public.routes ro on ro.id = rs.route_id
      join public.trips t on t.route_id = rs.route_id and t.status in ('completed','completed_forced') and t.started_at is not null
       and t.trip_date > current_date - 30
      join public.trip_stop_visits v on v.trip_id = t.id and v.stop_id = rs.stop_id
     where coalesce((public.org_setting(ro.org_id, 'learn_stop_times'))::boolean, true)
     group by rs.route_id, rs.stop_id, rs.planned_offset_min
  ), upd as (
    update public.route_stops rs set planned_offset_min = greatest(0, round(s.med))::int
      from samples s
     where rs.route_id = s.route_id and rs.stop_id = s.stop_id and s.n >= 3 and abs(s.med - rs.planned_offset_min) >= 2
    returning 1
  ) select count(*) into v_learned from upd;
  delete from public.location_points where ts < now() - interval '90 days';
  delete from public.device_events where created_at < now() - interval '30 days';
  delete from public.notification_outbox where created_at < now() - interval '60 days';
  delete from public.tracking_tokens where valid_date < current_date - 7;
  delete from public.pairing_codes where expires_at < now() - interval '1 day';
  delete from public.inbound_messages where created_at < now() - interval '90 days';
  return jsonb_build_object('trips_generated', v_trips, 'stop_times_learned', v_learned);
end $$;
revoke all on function public._escalate(), public.cron_minutely(), public.cron_evening(), public.cron_daily() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job where jobname = 'unway-evening';
    perform cron.schedule('unway-evening', '30 12 * * *', 'select public.cron_evening()');  -- 18:00 IST
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Platform (UnWay team) API
-- ---------------------------------------------------------------------
create or replace function public._require_platform() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'PLATFORM_ONLY' using errcode = '42501'; end if;
end $$;
revoke all on function public._require_platform() from public, anon, authenticated;

create or replace function public.platform_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._require_platform();
  select jsonb_build_object(
    'schools', (select count(*) from public.organizations),
    'schools_active', (select count(*) from public.organizations where status = 'active'),
    'schools_trial', (select count(*) from public.organizations where status = 'trial'),
    'buses', (select count(*) from public.buses where status <> 'retired'),
    'students', (select count(*) from public.students where transport_status = 'active'),
    'guardians', (select count(*) from public.guardians),
    'guardians_connected', (select count(distinct guardian_id) from public.guardian_channels where status = 'active'),
    'devices_paired', (select count(*) from public.devices where revoked_at is null),
    'devices_seen_1h', (select count(*) from public.devices where revoked_at is null and last_seen_at > now() - interval '1 hour'),
    'trips_today', (select count(*) from public.trips where trip_date = (now() at time zone 'Asia/Kolkata')::date and status <> 'cancelled'),
    'trips_active', (select count(*) from public.trips where status = 'active'),
    'scans_today', (select count(*) from public.scan_events where server_ts > date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' and result = 'ok'),
    'open_sos', (select count(*) from public.incidents where status <> 'resolved' and type like 'sos%'),
    'open_critical', (select count(*) from public.exceptions where status <> 'resolved' and severity in ('critical','high')),
    'outbox_queued', (select count(*) from public.notification_outbox where status in ('queued','sending')),
    'messages_24h', (select coalesce(jsonb_object_agg(channel, n), '{}'::jsonb) from (
        select channel, count(*) n from public.notification_outbox where created_at > now() - interval '24 hours' and status in ('sent','delivered','read') group by channel) q),
    'failed_24h', (select count(*) from public.notification_outbox where created_at > now() - interval '24 hours' and status = 'failed'),
    'whatsapp_30d', (select count(*) from public.notification_outbox where channel = 'whatsapp' and status in ('sent','delivered','read') and created_at > now() - interval '30 days'),
    'db_bytes', pg_database_size(current_database()),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'scans', sc, 'messages', ms) order by d), '[]'::jsonb) from (
        select d::date as d,
          (select count(*) from public.scan_events e where e.result = 'ok' and (e.server_ts at time zone 'Asia/Kolkata')::date = d::date) sc,
          (select count(*) from public.notification_outbox o where o.status in ('sent','delivered','read') and (o.created_at at time zone 'Asia/Kolkata')::date = d::date) ms
        from generate_series((now() at time zone 'Asia/Kolkata')::date - 13, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') d) q)
  ) into v;
  return v;
end $$;

create or replace function public.platform_schools() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_platform();
  return (select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', o.id, 'name', o.name, 'short_code', o.short_code, 'status', o.status, 'plan', o.plan, 'created_at', o.created_at,
      'contact_name', o.contact_name, 'contact_phone', o.contact_phone, 'contact_email', o.contact_email, 'notes', o.notes,
      'buses', (select count(*) from public.buses b where b.org_id = o.id and b.status <> 'retired'),
      'students', (select count(*) from public.students s where s.org_id = o.id and s.transport_status = 'active'),
      'guardians', (select count(*) from public.guardians g where g.org_id = o.id),
      'connected', (select count(distinct guardian_id) from public.guardian_channels gc where gc.org_id = o.id and gc.status = 'active'),
      'devices', (select count(*) from public.devices d where d.org_id = o.id and d.revoked_at is null),
      'admins', (select coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'role', u.role, 'name', u.name)), '[]'::jsonb) from public.org_users u where u.org_id = o.id),
      'trips_7d', (select count(*) from public.trips t where t.org_id = o.id and t.trip_date > current_date - 7 and t.status in ('completed','completed_forced','active')),
      'scans_7d', (select count(*) from public.scan_events e where e.org_id = o.id and e.server_ts > now() - interval '7 days' and e.result = 'ok'),
      'messages_30d', (select count(*) from public.notification_outbox n where n.org_id = o.id and n.created_at > now() - interval '30 days' and n.status in ('sent','delivered','read')),
      'whatsapp_30d', (select count(*) from public.notification_outbox n where n.org_id = o.id and n.channel = 'whatsapp' and n.created_at > now() - interval '30 days' and n.status in ('sent','delivered','read')),
      'open_exceptions', (select count(*) from public.exceptions x where x.org_id = o.id and x.status <> 'resolved'),
      'last_activity', greatest((select max(server_ts) from public.scan_events e where e.org_id = o.id),
                                (select max(created_at) from public.audit_log a where a.org_id = o.id))
    ) as x from public.organizations o) q);
end $$;

create or replace function public.platform_create_school(p_name text, p_short_code text, p_lat double precision, p_lng double precision,
  p_desk_phone text default null, p_contact_name text default null, p_contact_phone text default null, p_contact_email text default null,
  p_plan text default 'pilot', p_status text default 'trial') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  perform public._require_platform();
  insert into public.organizations(name, short_code, plan, status, contact_name, contact_phone, contact_email)
  values (trim(p_name), upper(trim(p_short_code)), coalesce(p_plan, 'pilot'), coalesce(p_status, 'trial'), p_contact_name, p_contact_phone, lower(p_contact_email))
  returning id into v_org;
  insert into public.org_secrets(org_id) values (v_org);
  insert into public.campuses(org_id, name, lat, lng, desk_phone) values (v_org, trim(p_name), p_lat, p_lng, p_desk_phone);
  perform public._audit(v_org, 'platform', auth.uid()::text, 'school_created_by_platform', 'organization', v_org::text, null);
  return v_org;
end $$;

create or replace function public.platform_update_school(p_org uuid, p_status text default null, p_plan text default null, p_notes text default null,
  p_contact_name text default null, p_contact_phone text default null, p_contact_email text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_platform();
  update public.organizations set
    status = coalesce(p_status, status), plan = coalesce(p_plan, plan), notes = coalesce(p_notes, notes),
    contact_name = coalesce(p_contact_name, contact_name), contact_phone = coalesce(p_contact_phone, contact_phone),
    contact_email = coalesce(p_contact_email, contact_email)
   where id = p_org;
  perform public._audit(p_org, 'platform', auth.uid()::text, 'school_updated_by_platform', 'organization', p_org::text,
    jsonb_build_object('status', p_status, 'plan', p_plan));
end $$;

create or replace function public.platform_view_school(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_platform();
  if exists (select 1 from public.org_users where user_id = auth.uid()) then
    raise exception 'ACCOUNT_BELONGS_TO_A_SCHOOL' using errcode = 'P0001';
  end if;
  if p_org is null then delete from public.platform_views where user_id = auth.uid(); return; end if;
  insert into public.platform_views(user_id, org_id) values (auth.uid(), p_org)
  on conflict (user_id) do update set org_id = excluded.org_id, started_at = now();
  perform public._audit(p_org, 'platform', auth.uid()::text, 'platform_view_started', 'organization', p_org::text, null);
end $$;

create or replace function public.platform_messages(p_status text default 'failed', p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_platform();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'school', o.name, 'event', n.event_type, 'channel', n.channel,
            'status', n.status, 'error', n.error, 'attempts', n.attempts, 'created_at', n.created_at) order by n.created_at desc), '[]'::jsonb)
    from (select * from public.notification_outbox where (p_status = 'all' or status = p_status)
           order by created_at desc limit least(p_limit, 500)) n
    left join public.organizations o on o.id = n.org_id);
end $$;

create or replace function public.platform_retry_failed() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform public._require_platform();
  update public.notification_outbox set status = 'queued', attempts = 0, next_attempt_at = now(), error = null
   where status = 'failed' and created_at > now() - interval '24 hours';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.platform_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_jobs jsonb := '[]'::jsonb; v_vault boolean := false;
begin
  perform public._require_platform();
  if to_regclass('cron.job') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'schedule', j.schedule,
               'last_status', r.status, 'last_run', r.start_time, 'message', left(r.return_message, 200)) order by j.jobname), '[]'::jsonb)
        from cron.job j
        left join lateral (select status, start_time, return_message from cron.job_run_details d where d.jobid = j.jobid order by start_time desc limit 1) r on true
       where j.jobname like 'unway-%'$q$ into v_jobs;
  end if;
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select count(*) = 2 from vault.decrypted_secrets where name in ('unway_functions_url','unway_dispatch_secret')$q$ into v_vault;
  end if;
  return jsonb_build_object(
    'jobs', v_jobs, 'dispatch_wired', v_vault, 'db_bytes', pg_database_size(current_database()), 'db_limit_bytes', 500 * 1024 * 1024,
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('table', relname, 'bytes', pg_total_relation_size(c.oid)) order by pg_total_relation_size(c.oid) desc), '[]'::jsonb)
                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r' and pg_total_relation_size(c.oid) > 0),
    'oldest_queued', (select min(created_at) from public.notification_outbox where status = 'queued'),
    'platform_admins', (select coalesce(jsonb_agg(email), '[]'::jsonb) from public.platform_admins));
end $$;

create or replace function public.platform_set_admin(p_email text, p_add boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_platform();
  if p_add then insert into public.platform_admins(email) values (lower(trim(p_email))) on conflict do nothing;
  elsif lower(trim(p_email)) <> lower(coalesce(auth.jwt()->>'email','')) then delete from public.platform_admins where email = lower(trim(p_email));
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['is_platform_admin()', 'platform_overview()', 'platform_schools()',
    'platform_create_school(text,text,double precision,double precision,text,text,text,text,text,text)',
    'platform_update_school(uuid,text,text,text,text,text,text)', 'platform_view_school(uuid)',
    'platform_messages(text,int)', 'platform_retry_failed()', 'platform_health()', 'platform_set_admin(text,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Self-serve signup creates a trial school (UnWay team can approve/activate)
-- (create_organization already inserts with the default status 'trial')
