-- =====================================================================
-- Core engine: exceptions, notifications outbox, manifest, scan logic.
-- Internal functions (prefixed with _) are not callable by API roles.
-- =====================================================================

-- Local date for an org
create or replace function public._org_today(p_org uuid) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone o.timezone)::date from public.organizations o where o.id = p_org
$$;

create or replace function public._fmt_time(p_org uuid, p_ts timestamptz) returns text
language sql stable security definer set search_path = public as $$
  select to_char(p_ts at time zone o.timezone, 'FMHH12:MI AM') from public.organizations o where o.id = p_org
$$;

create or replace function public._audit(p_org uuid, p_actor_type text, p_actor_id text, p_action text,
                                         p_entity text, p_entity_id text, p_data jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log(org_id, actor_type, actor_id, action, entity, entity_id, data)
  values (p_org, p_actor_type, p_actor_id, p_action, p_entity, p_entity_id, p_data)
$$;

-- ---------------------------------------------------------------------
-- Exceptions
-- ---------------------------------------------------------------------
create or replace function public._raise_exception(p_org uuid, p_trip uuid, p_student uuid, p_bus uuid,
                                                   p_code text, p_severity text, p_message text,
                                                   p_data jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.exceptions
   where coalesce(trip_id,'00000000-0000-0000-0000-000000000000') = coalesce(p_trip,'00000000-0000-0000-0000-000000000000')
     and coalesce(student_id,'00000000-0000-0000-0000-000000000000') = coalesce(p_student,'00000000-0000-0000-0000-000000000000')
     and code = p_code and status <> 'resolved';
  if v_id is not null then return v_id; end if;
  begin
    insert into public.exceptions(org_id, trip_id, student_id, bus_id, code, severity, message, data)
    values (p_org, p_trip, p_student, p_bus, p_code, p_severity, p_message, coalesce(p_data,'{}'::jsonb))
    returning id into v_id;
  exception when unique_violation then
    return null;
  end;
  return v_id;
end $$;

create or replace function public._auto_resolve_exceptions(p_trip uuid, p_student uuid, p_codes text[], p_note text)
returns void language sql security definer set search_path = public as $$
  update public.exceptions
     set status = 'resolved', resolved_at = now(), resolution_note = p_note
   where trip_id = p_trip
     and (p_student is null or student_id = p_student)
     and code = any(p_codes) and status <> 'resolved'
$$;

-- ---------------------------------------------------------------------
-- Tracking tokens (per guardian, per student, per day)
-- ---------------------------------------------------------------------
create or replace function public._tracking_token(p_org uuid, p_student uuid, p_guardian uuid, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  select token into v_token from public.tracking_tokens
   where student_id = p_student and coalesce(guardian_id,'00000000-0000-0000-0000-000000000000') = coalesce(p_guardian,'00000000-0000-0000-0000-000000000000')
     and valid_date = p_date;
  if v_token is null then
    insert into public.tracking_tokens(org_id, student_id, guardian_id, valid_date)
    values (p_org, p_student, p_guardian, p_date)
    on conflict do nothing
    returning token into v_token;
    if v_token is null then
      select token into v_token from public.tracking_tokens
       where student_id = p_student and coalesce(guardian_id,'00000000-0000-0000-0000-000000000000') = coalesce(p_guardian,'00000000-0000-0000-0000-000000000000')
         and valid_date = p_date;
    end if;
  end if;
  return v_token;
end $$;

-- ---------------------------------------------------------------------
-- Notification outbox
-- ---------------------------------------------------------------------
-- Events considered critical go to every active channel of every guardian.
create or replace function public._is_critical_event(p_event text) returns boolean language sql immutable as $$
  select p_event in ('MISSED_BOARDING','NOT_BOARDED_RETURN','DROP_UNCONFIRMED','INCIDENT','KEPT_ON_BUS')
$$;

create or replace function public._enqueue_student_event(p_event text, p_trip uuid, p_student uuid,
                                                         p_at timestamptz default now(),
                                                         p_extra jsonb default '{}'::jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_student public.students%rowtype;
  v_org     public.organizations%rowtype;
  v_trip    public.trips%rowtype;
  v_bus     text;
  v_desk    text;
  v_enabled jsonb;
  v_today   date;
  v_count   int := 0;
  g record;
  c record;
  v_payload jsonb;
  v_first   boolean;
begin
  select * into v_student from public.students where id = p_student;
  if not found then return 0; end if;
  select * into v_org from public.organizations where id = v_student.org_id;
  if p_trip is not null then
    select * into v_trip from public.trips where id = p_trip;
    select display_number into v_bus from public.buses where id = v_trip.bus_id;
  end if;
  select coalesce(c2.desk_phone, '') into v_desk
    from public.campuses c2 where c2.org_id = v_org.id
    order by (c2.id = v_student.campus_id) desc nulls last, c2.created_at limit 1;
  v_enabled := public.org_setting(v_org.id, 'channels');
  v_today := public._org_today(v_org.id);

  for g in
    select gd.* from public.student_guardians sg
      join public.guardians gd on gd.id = sg.guardian_id
     where sg.student_id = p_student and sg.notify
  loop
    v_first := true;
    for c in
      select gc.* from public.guardian_channels gc
       where gc.guardian_id = g.id and gc.status = 'active'
         and coalesce((v_enabled ->> gc.channel)::boolean, false)
       order by case gc.channel when 'whatsapp' then 1 when 'telegram' then 2 when 'webpush' then 3 else 4 end, gc.created_at
    loop
      exit when not v_first and not public._is_critical_event(p_event);
      v_payload := jsonb_build_object(
        'student_first_name', v_student.first_name,
        'school', v_org.name,
        'bus', coalesce(v_bus, ''),
        'time', public._fmt_time(v_org.id, coalesce(p_at, now())),
        'desk_phone', v_desk,
        'track_token', public._tracking_token(v_org.id, p_student, g.id, v_today),
        'track_base_url', public.org_setting(v_org.id, 'track_base_url') #>> '{}',
        'direction', v_trip.direction
      ) || coalesce(p_extra, '{}'::jsonb);
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

-- Staff alerts (SOS etc.) go to the school's linked Telegram chats.
create or replace function public._enqueue_staff(p_org uuid, p_event text, p_dedupe text, p_payload jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_chat text; v_count int := 0;
begin
  for v_chat in select jsonb_array_elements_text(coalesce(public.org_setting(p_org, 'staff_telegram_chat_ids'), '[]'::jsonb)) loop
    insert into public.notification_outbox(org_id, event_type, dedupe_key, recipient_type, channel, address, payload)
    values (p_org, p_event, p_event || ':' || p_dedupe, 'staff', 'telegram', v_chat, p_payload)
    on conflict do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Trips & manifests
-- ---------------------------------------------------------------------
create or replace function public.generate_trips_for_org(p_org uuid, p_date date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_tz text; v_dow int; v_count int := 0; r record; v_holiday boolean;
begin
  select timezone into v_tz from public.organizations where id = p_org;
  select exists(select 1 from public.calendar_days where org_id = p_org and date = p_date and type = 'holiday') into v_holiday;
  if v_holiday then return 0; end if;
  v_dow := extract(isodow from p_date)::int - 1;  -- 0 = Monday
  for r in select * from public.routes where org_id = p_org and active and (days_mask & (1 << v_dow)) <> 0 loop
    insert into public.trips(org_id, route_id, bus_id, trip_date, direction, scheduled_start)
    values (p_org, r.id, r.default_bus_id, p_date, r.direction, (p_date + r.scheduled_start) at time zone v_tz)
    on conflict (route_id, trip_date) do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

create or replace function public._build_manifest(p_trip uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_trip public.trips%rowtype; v_count int;
begin
  select * into v_trip from public.trips where id = p_trip;
  insert into public.trip_manifest(org_id, trip_id, student_id, stop_id, state)
  select v_trip.org_id, v_trip.id, a.student_id, a.stop_id,
         case when exists (select 1 from public.absences ab
                            where ab.student_id = a.student_id and ab.date = v_trip.trip_date and ab.cancelled_at is null
                              and (ab.legs = 'BOTH' or (ab.legs = 'AM' and v_trip.direction = 'MORNING')
                                                    or (ab.legs = 'PM' and v_trip.direction = 'AFTERNOON')))
              then 'ABSENT_NOTIFIED' else 'EXPECTED' end
    from public.transport_assignments a
    join public.students s on s.id = a.student_id and s.transport_status = 'active'
   where a.route_id = v_trip.route_id
     and a.effective_from <= v_trip.trip_date
     and (a.effective_to is null or a.effective_to >= v_trip.trip_date)
  on conflict (trip_id, student_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- The trip a student *should* be on today for a direction (by assignment).
create or replace function public._assigned_trip(p_student uuid, p_date date, p_direction text) returns uuid
language sql stable security definer set search_path = public as $$
  select t.id from public.transport_assignments a
    join public.trips t on t.route_id = a.route_id and t.trip_date = p_date
   where a.student_id = p_student and a.direction = p_direction
     and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
     and t.status not in ('cancelled')
   limit 1
$$;

-- ---------------------------------------------------------------------
-- QR credentials
-- Payload: UW1.<ORG>.<PUBLIC_ID>.<VERSION>.<SIG16>
-- SIG16 = first 16 hex chars of HMAC-SHA256("<ORG>.<PUBLIC_ID>.<VERSION>", org secret)
-- ---------------------------------------------------------------------
create or replace function public._qr_payload(p_student uuid) returns text
language sql stable security definer set search_path = public as $$
  select 'UW1.' || o.short_code || '.' || s.public_id || '.' || s.cred_version || '.' ||
         left(encode(extensions.hmac(o.short_code || '.' || s.public_id || '.' || s.cred_version, sec.qr_secret, 'sha256'), 'hex'), 16)
    from public.students s
    join public.organizations o on o.id = s.org_id
    join public.org_secrets sec on sec.org_id = o.id
   where s.id = p_student
$$;

-- Returns (student_id, status) where status in ok / invalid / revoked / unknown / other_org
create or replace function public._qr_verify(p_org uuid, p_raw text, out student_id uuid, out status text)
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[]; v_short text; v_sig text; v_expected text; v_ver int; v_cur int;
begin
  status := 'invalid';
  parts := string_to_array(trim(p_raw), '.');
  if array_length(parts, 1) <> 5 or parts[1] <> 'UW1' or parts[4] !~ '^\d+$' then return; end if;
  select short_code into v_short from public.organizations where id = p_org;
  if parts[2] <> v_short then status := 'other_org'; return; end if;
  select s.id, s.cred_version into student_id, v_cur from public.students s
   where s.org_id = p_org and s.public_id = parts[3];
  if student_id is null then status := 'unknown'; return; end if;
  v_ver := parts[4]::int;
  select left(encode(extensions.hmac(parts[2] || '.' || parts[3] || '.' || parts[4], sec.qr_secret, 'sha256'), 'hex'), 16)
    into v_expected from public.org_secrets sec where sec.org_id = p_org;
  if lower(parts[5]) <> v_expected then status := 'invalid'; student_id := null; return; end if;
  if v_ver < v_cur then status := 'revoked'; return; end if;
  status := 'ok';
end $$;

-- ---------------------------------------------------------------------
-- Scan engine (shared by device, admin and bulk paths)
-- ---------------------------------------------------------------------
create or replace function public._nearest_stop(p_route uuid, p_lat double precision, p_lng double precision)
returns uuid language sql stable security definer set search_path = public as $$
  select s.id from public.route_stops rs join public.stops s on s.id = rs.stop_id
   where rs.route_id = p_route and p_lat is not null
     and public.geo_dist_m(p_lat, p_lng, s.lat, s.lng) <= greatest(s.radius_m * 2, 150)
   order by public.geo_dist_m(p_lat, p_lng, s.lat, s.lng) limit 1
$$;

create or replace function public._apply_scan(
  p_trip uuid, p_student uuid, p_type text, p_method text, p_ts timestamptz,
  p_lat double precision, p_lng double precision, p_acc double precision,
  p_crew uuid, p_device uuid, p_reason text, p_cid text, p_raw text, p_override text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_trip   public.trips%rowtype;
  v_m      public.trip_manifest%rowtype;
  v_stu    public.students%rowtype;
  v_type   text := p_type;
  v_ts     timestamptz := least(coalesce(p_ts, now()), now());
  v_window int;
  v_other  uuid;
  v_other_bus text;
  v_stop   uuid;
  v_stop_name text;
  v_event  text;
  v_dist   double precision;
  v_state  text;
  v_name   text;
begin
  select * into v_trip from public.trips where id = p_trip;
  if not found then return jsonb_build_object('ok', false, 'result', 'trip_not_found'); end if;
  select * into v_stu from public.students where id = p_student and org_id = v_trip.org_id;
  if not found then return jsonb_build_object('ok', false, 'result', 'unknown'); end if;
  v_name := v_stu.first_name || coalesce(' ' || nullif(left(v_stu.last_name, 1), '') || '.', '');
  v_window := coalesce((public.org_setting(v_trip.org_id, 'dup_window_s'))::int, 120);
  v_stop := public._nearest_stop(v_trip.route_id, p_lat, p_lng);

  select * into v_m from public.trip_manifest where trip_id = p_trip and student_id = p_student for update;

  if not found then
    -- Not on this bus's manifest: wrong bus or not enrolled.
    v_other := public._assigned_trip(p_student, v_trip.trip_date, v_trip.direction);
    if v_other is not null and v_other <> p_trip then
      select b.display_number into v_other_bus from public.trips t left join public.buses b on b.id = t.bus_id where t.id = v_other;
      if coalesce(p_override, '') = 'allow_wrong_bus' then
        insert into public.trip_manifest(org_id, trip_id, student_id, stop_id, state, board_at, is_guest, resolved_reason)
        values (v_trip.org_id, p_trip, p_student, v_stop, 'ON_BOARD', v_ts, true, 'Allowed on wrong bus');
        update public.trip_manifest set state = 'TRANSFERRED', state_at = now(), transferred_to = p_trip,
               resolved_reason = 'Travelled on another bus'
         where trip_id = v_other and student_id = p_student and state in ('EXPECTED','MISSED','ABSENT_NOTIFIED');
        insert into public.scan_events(client_event_id, org_id, trip_id, bus_id, device_id, student_id, type, method, result,
                                       device_ts, lat, lng, accuracy_m, stop_id, crew_id, reason, raw)
        values (p_cid, v_trip.org_id, p_trip, v_trip.bus_id, p_device, p_student, 'BOARD', p_method, 'ok',
                v_ts, p_lat, p_lng, p_acc, v_stop, p_crew, coalesce(p_reason, 'wrong bus allowed'), p_raw);
        perform public._raise_exception(v_trip.org_id, p_trip, p_student, v_trip.bus_id, 'WRONG_BUS', 'medium',
                v_name || ' allowed on this bus instead of Bus ' || coalesce(v_other_bus, '?'),
                jsonb_build_object('assigned_trip', v_other, 'assigned_bus', v_other_bus));
        select display_number into v_stop_name from public.buses where id = v_trip.bus_id;
        perform public._enqueue_student_event('BUS_CHANGED', p_trip, p_student, v_ts,
                jsonb_build_object('usual_bus', coalesce(v_other_bus, '')));
        return jsonb_build_object('ok', true, 'result', 'ok', 'type', 'BOARD', 'state', 'ON_BOARD',
                                  'student_id', p_student, 'name', v_name, 'transferred', true);
      end if;
      insert into public.scan_events(client_event_id, org_id, trip_id, bus_id, device_id, student_id, type, method, result,
                                     device_ts, lat, lng, accuracy_m, stop_id, crew_id, reason, raw)
      values (p_cid, v_trip.org_id, p_trip, v_trip.bus_id, p_device, p_student, p_type, p_method, 'wrong_bus',
              v_ts, p_lat, p_lng, p_acc, v_stop, p_crew, p_reason, p_raw);
      perform public._raise_exception(v_trip.org_id, p_trip, p_student, v_trip.bus_id, 'WRONG_BUS', 'medium',
              v_name || ' tried to board the wrong bus (belongs to Bus ' || coalesce(v_other_bus, '?') || ')',
              jsonb_build_object('assigned_trip', v_other, 'assigned_bus', v_other_bus));
      return jsonb_build_object('ok', false, 'result', 'wrong_bus', 'student_id', p_student, 'name', v_name,
                                'correct_bus', v_other_bus);
    end if;
    insert into public.scan_events(client_event_id, org_id, trip_id, bus_id, device_id, student_id, type, method, result,
                                   device_ts, lat, lng, accuracy_m, stop_id, crew_id, reason, raw)
    values (p_cid, v_trip.org_id, p_trip, v_trip.bus_id, p_device, p_student, p_type, p_method, 'not_enrolled',
            v_ts, p_lat, p_lng, p_acc, v_stop, p_crew, p_reason, p_raw);
    return jsonb_build_object('ok', false, 'result', 'not_enrolled', 'student_id', p_student, 'name', v_name);
  end if;

  -- Infer type
  if v_type is null then
    if v_m.state = 'ON_BOARD' then v_type := 'DEBOARD';
    elsif v_m.state in ('DROPPED','HANDED_OVER','TRANSFERRED') then
      return jsonb_build_object('ok', false, 'result', 'duplicate', 'state', v_m.state, 'student_id', p_student,
                                'name', v_name, 'message', 'Already dropped');
    else v_type := 'BOARD';
    end if;
  end if;

  -- Duplicate window / impossible transitions
  -- (an inferred scan right after any successful scan is treated as an accidental double scan)
  if (v_type = 'BOARD' and v_m.state = 'ON_BOARD')
     or (v_type = 'DEBOARD' and v_m.state in ('DROPPED','HANDED_OVER'))
     or exists (select 1 from public.scan_events e where e.trip_id = p_trip and e.student_id = p_student
                  and (e.type = v_type or p_type is null) and e.result = 'ok'
                  and e.server_ts > now() - make_interval(secs => v_window)) then
    if p_type is null and v_type = 'DEBOARD' then v_type := 'BOARD'; end if;
    insert into public.scan_events(client_event_id, org_id, trip_id, bus_id, device_id, student_id, type, method, result,
                                   device_ts, lat, lng, accuracy_m, stop_id, crew_id, reason, raw)
    values (p_cid, v_trip.org_id, p_trip, v_trip.bus_id, p_device, p_student, v_type, p_method, 'duplicate',
            v_ts, p_lat, p_lng, p_acc, v_stop, p_crew, p_reason, p_raw);
    return jsonb_build_object('ok', false, 'result', 'duplicate', 'type', v_type, 'state', v_m.state,
                              'student_id', p_student, 'name', v_name,
                              'at', public._fmt_time(v_trip.org_id, coalesce(case when v_type='BOARD' then v_m.board_at else v_m.drop_at end, v_m.state_at)));
  end if;

  if v_type = 'BOARD' then
    v_state := 'ON_BOARD';
    update public.trip_manifest set state = v_state, state_at = now(), board_at = v_ts,
           resolved_reason = case when p_method <> 'qr' then coalesce(p_reason, 'manual') else resolved_reason end
     where trip_id = p_trip and student_id = p_student;
    perform public._auto_resolve_exceptions(p_trip, p_student, array['MISSED_BOARDING','NOT_BOARDED_RETURN'], 'Student boarded later');
    update public.absences set cancelled_at = now()
     where student_id = p_student and date = v_trip.trip_date and cancelled_at is null;
    v_event := case when v_trip.direction = 'MORNING' then 'BOARDED' else 'BOARDED_RETURN' end;
  else
    v_state := 'DROPPED';
    update public.trip_manifest set state = v_state, state_at = now(), drop_at = v_ts,
           resolved_reason = case when p_method <> 'qr' then coalesce(p_reason, 'manual') else resolved_reason end
     where trip_id = p_trip and student_id = p_student;
    v_event := case when v_trip.direction = 'MORNING' then 'REACHED_SCHOOL' else 'DROPPED' end;
    if v_trip.direction = 'AFTERNOON' and v_m.stop_id is not null and p_lat is not null then
      select public.geo_dist_m(p_lat, p_lng, s.lat, s.lng) into v_dist from public.stops s where s.id = v_m.stop_id;
      if v_dist > coalesce((public.org_setting(v_trip.org_id, 'drop_far_m'))::int, 300) then
        perform public._raise_exception(v_trip.org_id, p_trip, p_student, v_trip.bus_id, 'WRONG_STOP_DROP', 'medium',
                v_name || ' was dropped ' || round(v_dist) || ' m away from the assigned stop',
                jsonb_build_object('distance_m', round(v_dist), 'lat', p_lat, 'lng', p_lng));
      end if;
    end if;
    perform public._auto_resolve_exceptions(p_trip, p_student, array['DROP_NOT_SCANNED','DROP_UNCONFIRMED'], 'Drop-off recorded');
  end if;

  insert into public.scan_events(client_event_id, org_id, trip_id, bus_id, device_id, student_id, type, method, result,
                                 device_ts, lat, lng, accuracy_m, stop_id, crew_id, reason, raw)
  values (p_cid, v_trip.org_id, p_trip, v_trip.bus_id, p_device, p_student, v_type, p_method, 'ok',
          v_ts, p_lat, p_lng, p_acc, coalesce(v_stop, case when v_type='BOARD' or v_trip.direction='AFTERNOON' then v_m.stop_id end),
          p_crew, p_reason, p_raw);

  select s.name into v_stop_name from public.stops s
   where s.id = coalesce(v_stop, v_m.stop_id);
  perform public._enqueue_student_event(v_event, p_trip, p_student, v_ts,
          jsonb_build_object('stop', coalesce(v_stop_name, '')));

  return jsonb_build_object('ok', true, 'result', 'ok', 'type', v_type, 'state', v_state,
                            'student_id', p_student, 'name', v_name,
                            'at', public._fmt_time(v_trip.org_id, v_ts));
end $$;

-- Resolution of a manifest entry (crew at a stop / at trip end, or admin)
create or replace function public._resolve_student(p_trip uuid, p_student uuid, p_resolution text, p_note text,
                                                   p_ts timestamptz, p_actor text, p_device uuid, p_crew uuid, p_cid text,
                                                   p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_trip public.trips%rowtype; v_m public.trip_manifest%rowtype; v_name text; v_ts timestamptz := least(coalesce(p_ts, now()), now());
  v_stop_name text;
begin
  select * into v_trip from public.trips where id = p_trip;
  select * into v_m from public.trip_manifest where trip_id = p_trip and student_id = p_student for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_IN_MANIFEST', 'student_id', p_student); end if;
  select first_name || coalesce(' ' || nullif(left(last_name,1),'') || '.', '') into v_name from public.students where id = p_student;

  case p_resolution
    when 'wait' then
      return jsonb_build_object('ok', true, 'state', v_m.state, 'student_id', p_student);
    when 'boarded_unscanned' then
      return public._apply_scan(p_trip, p_student, 'BOARD', case when p_actor = 'admin' then 'admin' else 'manual' end,
                                v_ts, p_lat, p_lng, null, p_crew, p_device, coalesce(p_note, 'boarded, not scanned'), p_cid, null, null);
    when 'dropped_unscanned' then
      return public._apply_scan(p_trip, p_student, 'DEBOARD', case when p_actor = 'admin' then 'admin' else 'manual' end,
                                v_ts, p_lat, p_lng, null, p_crew, p_device, coalesce(p_note, 'dropped, not scanned'), p_cid, null, null);
    when 'absent' then
      update public.trip_manifest set state = 'ABSENT_NOTIFIED', state_at = now(), resolved_reason = coalesce(p_note, 'absent')
       where trip_id = p_trip and student_id = p_student;
      perform public._auto_resolve_exceptions(p_trip, p_student, array['MISSED_BOARDING','NOT_BOARDED_RETURN'], 'Marked absent');
    when 'parent_pickup' then
      update public.trip_manifest set state = 'NO_SHOW', state_at = now(), resolved_reason = coalesce(p_note, 'picked up by parent')
       where trip_id = p_trip and student_id = p_student;
      perform public._auto_resolve_exceptions(p_trip, p_student, array['MISSED_BOARDING','NOT_BOARDED_RETURN'], 'Picked up by parent');
    when 'no_show' then
      if v_m.state not in ('EXPECTED','MISSED') then
        return jsonb_build_object('ok', false, 'code', 'INVALID_STATE', 'state', v_m.state, 'student_id', p_student);
      end if;
      update public.trip_manifest set state = 'MISSED', state_at = now(), resolved_reason = coalesce(p_note, 'not present')
       where trip_id = p_trip and student_id = p_student;
      select name into v_stop_name from public.stops where id = v_m.stop_id;
      if v_trip.direction = 'MORNING' then
        perform public._raise_exception(v_trip.org_id, p_trip, p_student, v_trip.bus_id, 'MISSED_BOARDING', 'high',
                v_name || ' did not board at ' || coalesce(v_stop_name, 'the stop'), jsonb_build_object('stop_id', v_m.stop_id));
        perform public._enqueue_student_event('MISSED_BOARDING', p_trip, p_student, v_ts, jsonb_build_object('stop', coalesce(v_stop_name,'')));
      else
        perform public._raise_exception(v_trip.org_id, p_trip, p_student, v_trip.bus_id, 'NOT_BOARDED_RETURN', 'critical',
                v_name || ' did not board the return bus' || coalesce(' (' || p_note || ')', ''), '{}'::jsonb);
        perform public._enqueue_student_event('NOT_BOARDED_RETURN', p_trip, p_student, v_ts, '{}'::jsonb);
      end if;
    when 'handed_over' then
      if v_m.state <> 'ON_BOARD' then
        return jsonb_build_object('ok', false, 'code', 'INVALID_STATE', 'state', v_m.state, 'student_id', p_student);
      end if;
      update public.trip_manifest set state = 'HANDED_OVER', state_at = now(), drop_at = v_ts, resolved_reason = coalesce(p_note, 'handed to guardian')
       where trip_id = p_trip and student_id = p_student;
      select name into v_stop_name from public.stops where id = v_m.stop_id;
      perform public._enqueue_student_event(case when v_trip.direction='MORNING' then 'REACHED_SCHOOL' else 'DROPPED' end,
              p_trip, p_student, v_ts, jsonb_build_object('stop', coalesce(v_stop_name,''), 'handover', coalesce(p_note, 'guardian')));
    when 'kept_on_bus' then
      perform public._raise_exception(v_trip.org_id, p_trip, p_student, v_trip.bus_id, 'GUARDIAN_ABSENT', 'high',
              v_name || ' kept on bus: no guardian at stop', '{}'::jsonb);
      perform public._enqueue_student_event('KEPT_ON_BUS', p_trip, p_student, v_ts, '{}'::jsonb);
    when 'unconfirmed' then
      update public.trip_manifest set state = 'UNCONFIRMED', state_at = now(), resolved_reason = coalesce(p_note, 'unconfirmed')
       where trip_id = p_trip and student_id = p_student;
      perform public._raise_exception(v_trip.org_id, p_trip, p_student, v_trip.bus_id, 'DROP_UNCONFIRMED', 'critical',
              v_name || ': drop-off not confirmed', '{}'::jsonb);
    else
      return jsonb_build_object('ok', false, 'code', 'UNKNOWN_RESOLUTION');
  end case;

  if p_actor = 'admin' then
    perform public._audit(v_trip.org_id, 'user', auth.uid()::text, 'resolve_student', 'trip_manifest', p_trip::text,
                          jsonb_build_object('student_id', p_student, 'resolution', p_resolution, 'note', p_note));
  end if;
  select state into v_m.state from public.trip_manifest where trip_id = p_trip and student_id = p_student;
  return jsonb_build_object('ok', true, 'state', v_m.state, 'student_id', p_student);
end $$;

-- Called when the bus leaves a stop geofence
create or replace function public._on_stop_exit(p_trip uuid, p_stop uuid, p_ts timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_trip public.trips%rowtype; r record; v_stop_name text;
begin
  select * into v_trip from public.trips where id = p_trip;
  select name into v_stop_name from public.stops where id = p_stop;
  if v_trip.direction = 'MORNING' then
    for r in select m.student_id, s.first_name from public.trip_manifest m join public.students s on s.id = m.student_id
              where m.trip_id = p_trip and m.stop_id = p_stop and m.state = 'EXPECTED' loop
      update public.trip_manifest set state = 'MISSED', state_at = now(), resolved_reason = 'bus left stop'
       where trip_id = p_trip and student_id = r.student_id;
      perform public._raise_exception(v_trip.org_id, p_trip, r.student_id, v_trip.bus_id, 'MISSED_BOARDING', 'high',
              r.first_name || ' did not board at ' || coalesce(v_stop_name, 'stop'), jsonb_build_object('stop_id', p_stop));
      perform public._enqueue_student_event('MISSED_BOARDING', p_trip, r.student_id, p_ts, jsonb_build_object('stop', coalesce(v_stop_name,'')));
    end loop;
  else
    for r in select m.student_id, s.first_name from public.trip_manifest m join public.students s on s.id = m.student_id
              where m.trip_id = p_trip and m.stop_id = p_stop and m.state = 'ON_BOARD' loop
      perform public._raise_exception(v_trip.org_id, p_trip, r.student_id, v_trip.bus_id, 'DROP_NOT_SCANNED', 'medium',
              r.first_name || ' still on board after ' || coalesce(v_stop_name, 'stop'), jsonb_build_object('stop_id', p_stop));
    end loop;
  end if;
end $$;

-- Called when the afternoon bus leaves the school
create or replace function public._on_school_departure(p_trip uuid, p_ts timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_trip public.trips%rowtype; r record;
begin
  select * into v_trip from public.trips where id = p_trip;
  update public.trips set departed_school_at = coalesce(departed_school_at, p_ts) where id = p_trip;
  if v_trip.direction <> 'AFTERNOON' then return; end if;
  for r in select m.student_id, s.first_name from public.trip_manifest m join public.students s on s.id = m.student_id
            where m.trip_id = p_trip and m.state = 'EXPECTED' loop
    update public.trip_manifest set state = 'MISSED', state_at = now(), resolved_reason = 'bus left school'
     where trip_id = p_trip and student_id = r.student_id;
    perform public._raise_exception(v_trip.org_id, p_trip, r.student_id, v_trip.bus_id, 'NOT_BOARDED_RETURN', 'critical',
            r.first_name || ' did not board the return bus', '{}'::jsonb);
    perform public._enqueue_student_event('NOT_BOARDED_RETURN', p_trip, r.student_id, p_ts, '{}'::jsonb);
  end loop;
end $$;

-- Lock down internal functions
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like '\_%' or p.proname in ('generate_trips_for_org','org_setting'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
