-- =====================================================================
-- Bus device API. Called by the Android app with the public (anon) key.
-- Every function authenticates the device by its secret token.
-- =====================================================================

create or replace function public._device_auth(p_token text) returns public.devices
language plpgsql security definer set search_path = public as $$
declare d public.devices%rowtype;
begin
  select * into d from public.devices where token_hash = public.sha256_hex(coalesce(p_token, '')) and revoked_at is null;
  if not found then
    raise exception 'DEVICE_UNAUTHORIZED' using errcode = 'P0001';
  end if;
  update public.devices set last_seen_at = now() where id = d.id;
  return d;
end $$;
revoke all on function public._device_auth(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Pairing
-- ---------------------------------------------------------------------
create or replace function public.dev_pair(p_code text, p_info jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code public.pairing_codes%rowtype; v_token text; v_dev uuid; v_bus public.buses%rowtype; v_org public.organizations%rowtype;
begin
  select * into v_code from public.pairing_codes
   where code = upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'))
     and used_at is null and expires_at > now()
   for update;
  if not found then raise exception 'PAIRING_CODE_INVALID' using errcode = 'P0001'; end if;

  update public.devices set revoked_at = now() where bus_id = v_code.bus_id and revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.devices(org_id, bus_id, token_hash, model, os_version, app_version)
  values (v_code.org_id, v_code.bus_id, public.sha256_hex(v_token), p_info->>'model', p_info->>'os_version', p_info->>'app_version')
  returning id into v_dev;
  update public.pairing_codes set used_at = now() where code = v_code.code;

  select * into v_bus from public.buses where id = v_code.bus_id;
  select * into v_org from public.organizations where id = v_code.org_id;
  perform public._audit(v_org.id, 'device', v_dev::text, 'paired', 'bus', v_bus.id::text, p_info);
  return jsonb_build_object(
    'device_token', v_token, 'device_id', v_dev,
    'bus', jsonb_build_object('id', v_bus.id, 'display_number', v_bus.display_number, 'registration_no', v_bus.registration_no),
    'org', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'short_code', v_org.short_code));
end $$;

-- ---------------------------------------------------------------------
-- Bootstrap: bus, crew, today's trips, policies
-- ---------------------------------------------------------------------
create or replace function public.dev_bootstrap(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.devices%rowtype; v_org public.organizations%rowtype; v_bus public.buses%rowtype; v_today date;
  v_crew jsonb; v_trips jsonb; v_campus jsonb;
begin
  d := public._device_auth(p_token);
  select * into v_org from public.organizations where id = d.org_id;
  select * into v_bus from public.buses where id = d.bus_id;
  v_today := public._org_today(v_org.id);
  perform public.generate_trips_for_org(v_org.id, v_today);

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'role', c.role, 'pin_hash', c.pin_hash)
                            order by c.role, c.name), '[]'::jsonb)
    into v_crew
    from public.crew_members c
   where c.org_id = v_org.id and c.active
     and (exists (select 1 from public.bus_crew bc where bc.bus_id = v_bus.id and bc.crew_id = c.id)
          or not exists (select 1 from public.bus_crew bc where bc.bus_id = v_bus.id));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'direction', t.direction, 'route_code', r.code, 'route_name', r.name,
           'scheduled_start', t.scheduled_start, 'status', t.status, 'started_at', t.started_at,
           'completed_at', t.completed_at,
           'expected', (select count(*) from public.transport_assignments a where a.route_id = r.id
                          and a.effective_from <= t.trip_date and (a.effective_to is null or a.effective_to >= t.trip_date)))
           order by t.scheduled_start), '[]'::jsonb)
    into v_trips
    from public.trips t join public.routes r on r.id = t.route_id
   where t.bus_id = v_bus.id and t.trip_date = v_today and t.status <> 'cancelled';

  select jsonb_build_object('name', c.name, 'lat', c.lat, 'lng', c.lng, 'radius_m', c.geofence_radius_m, 'desk_phone', c.desk_phone)
    into v_campus from public.campuses c where c.org_id = v_org.id order by c.created_at limit 1;

  return jsonb_build_object(
    'server_ts', now(), 'today', v_today,
    'bus', jsonb_build_object('id', v_bus.id, 'display_number', v_bus.display_number, 'registration_no', v_bus.registration_no, 'capacity', v_bus.capacity),
    'org', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'short_code', v_org.short_code, 'timezone', v_org.timezone, 'logo_url', v_org.logo_url),
    'campus', v_campus,
    'policies', public.default_settings() || v_org.settings - 'staff_telegram_chat_ids',
    'crew', v_crew,
    'trips', v_trips);
end $$;

-- ---------------------------------------------------------------------
-- Trip data (stops + manifest + other-bus index) for offline use
-- ---------------------------------------------------------------------
create or replace function public._trip_payload(p_trip uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_trip public.trips%rowtype; v_route public.routes%rowtype; v_stops jsonb; v_manifest jsonb; v_other jsonb; v_campus jsonb;
begin
  select * into v_trip from public.trips where id = p_trip;
  select * into v_route from public.routes where id = v_trip.route_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'landmark', s.landmark, 'lat', s.lat, 'lng', s.lng, 'radius_m', s.radius_m,
           'seq', rs.seq, 'planned_time', to_char((v_trip.scheduled_start + make_interval(mins => rs.planned_offset_min)) at time zone o.timezone, 'FMHH12:MI AM'),
           'entered_at', v.entered_at, 'exited_at', v.exited_at) order by rs.seq), '[]'::jsonb)
    into v_stops
    from public.route_stops rs join public.stops s on s.id = rs.stop_id
    join public.organizations o on o.id = v_trip.org_id
    left join public.trip_stop_visits v on v.trip_id = p_trip and v.stop_id = s.id
   where rs.route_id = v_route.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'student_id', st.id, 'public_id', st.public_id, 'cred_version', st.cred_version,
           'name', st.first_name || coalesce(' ' || nullif(left(st.last_name,1),'') || '.', ''),
           'class', concat_ws('-', st.class_name, st.section),
           'stop_id', m.stop_id, 'state', m.state, 'board_at', m.board_at, 'drop_at', m.drop_at,
           'photo', st.photo_thumb, 'special_care', st.special_care_note,
           'handover_required', st.handover_required, 'is_guest', m.is_guest) order by st.first_name), '[]'::jsonb)
    into v_manifest
    from public.trip_manifest m join public.students st on st.id = m.student_id
   where m.trip_id = p_trip;

  -- Students on *other* buses today in the same direction (for offline wrong-bus detection)
  select coalesce(jsonb_agg(jsonb_build_object('public_id', st.public_id, 'bus', b.display_number, 'name', st.first_name)), '[]'::jsonb)
    into v_other
    from public.transport_assignments a
    join public.trips t on t.route_id = a.route_id and t.trip_date = v_trip.trip_date and t.id <> p_trip
    join public.students st on st.id = a.student_id and st.transport_status = 'active'
    left join public.buses b on b.id = t.bus_id
   where a.org_id = v_trip.org_id and a.direction = v_trip.direction
     and a.effective_from <= v_trip.trip_date and (a.effective_to is null or a.effective_to >= v_trip.trip_date);

  select jsonb_build_object('name', c.name, 'lat', c.lat, 'lng', c.lng, 'radius_m', c.geofence_radius_m, 'desk_phone', c.desk_phone)
    into v_campus from public.campuses c
   where c.org_id = v_trip.org_id order by (c.id = v_route.campus_id) desc, c.created_at limit 1;

  return jsonb_build_object(
    'trip', jsonb_build_object('id', v_trip.id, 'direction', v_trip.direction, 'status', v_trip.status,
             'route_code', v_route.code, 'route_name', v_route.name, 'trip_date', v_trip.trip_date,
             'scheduled_start', v_trip.scheduled_start, 'started_at', v_trip.started_at,
             'arrived_at', v_trip.arrived_at, 'departed_school_at', v_trip.departed_school_at,
             'empty_bus_check', v_trip.empty_bus_check, 'driver_id', v_trip.driver_id, 'attendant_id', v_trip.attendant_id),
    'school', v_campus, 'stops', v_stops, 'manifest', v_manifest, 'other_buses', v_other, 'server_ts', now());
end $$;
revoke all on function public._trip_payload(uuid) from public, anon, authenticated;

create or replace function public._device_trip(d public.devices, p_trip uuid) returns public.trips
language plpgsql security definer set search_path = public as $$
declare t public.trips%rowtype;
begin
  select * into t from public.trips where id = p_trip and org_id = d.org_id;
  if not found or t.bus_id is distinct from d.bus_id then
    raise exception 'TRIP_NOT_FOR_THIS_BUS' using errcode = 'P0001';
  end if;
  return t;
end $$;
revoke all on function public._device_trip(public.devices, uuid) from public, anon, authenticated;

create or replace function public.dev_trip_data(p_token text, p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.devices%rowtype; t public.trips%rowtype;
begin
  d := public._device_auth(p_token);
  t := public._device_trip(d, p_trip_id);
  if t.status = 'active' then perform public._build_manifest(t.id); end if;  -- pick up late additions
  return public._trip_payload(t.id);
end $$;

create or replace function public.dev_start_trip(p_token text, p_trip_id uuid, p_driver_id uuid, p_attendant_id uuid,
                                                 p_lat double precision default null, p_lng double precision default null,
                                                 p_device_ts timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.devices%rowtype; t public.trips%rowtype;
begin
  d := public._device_auth(p_token);
  t := public._device_trip(d, p_trip_id);
  if t.status in ('completed','completed_forced','cancelled','aborted_auto') then
    raise exception 'TRIP_ALREADY_CLOSED' using errcode = 'P0001';
  end if;
  if t.status = 'scheduled' then
    update public.trips set status = 'active', started_at = least(coalesce(p_device_ts, now()), now()),
           driver_id = p_driver_id, attendant_id = p_attendant_id, device_id = d.id
     where id = t.id;
    perform public._auto_resolve_exceptions(t.id, null, array['TRIP_LATE_START'], 'Trip started');
    perform public._audit(d.org_id, 'device', d.id::text, 'trip_started', 'trip', t.id::text,
                          jsonb_build_object('driver', p_driver_id, 'attendant', p_attendant_id));
  end if;
  perform public._build_manifest(t.id);
  insert into public.bus_live_state(bus_id, org_id, trip_id, lat, lng, recorded_at, updated_at)
  values (d.bus_id, d.org_id, t.id, p_lat, p_lng, now(), now())
  on conflict (bus_id) do update set trip_id = excluded.trip_id,
     lat = coalesce(excluded.lat, bus_live_state.lat), lng = coalesce(excluded.lng, bus_live_state.lng), updated_at = now();
  return public._trip_payload(t.id);
end $$;

-- ---------------------------------------------------------------------
-- Sync: batch of queued events from the device (idempotent)
-- event = {id, kind, trip_id, ts, lat, lng, acc, crew_id, data:{...}}
-- kinds: scan | resolve | arrive | depart_school | empty_check | complete | sos | delay
-- ---------------------------------------------------------------------
create or replace function public._dev_event(d public.devices, e jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := e->>'kind';
  v_cid  text := e->>'id';
  v_trip public.trips%rowtype;
  v_ts   timestamptz := least(coalesce((e->>'ts')::timestamptz, now()), now());
  v_lat  double precision := (e->>'lat')::double precision;
  v_lng  double precision := (e->>'lng')::double precision;
  v_acc  double precision := (e->>'acc')::double precision;
  v_crew uuid := nullif(e->>'crew_id','')::uuid;
  v_data jsonb := coalesce(e->'data', '{}'::jsonb);
  v_student uuid;
  v_status text;
  v_res jsonb;
  v_results jsonb := '[]'::jsonb;
  v_item jsonb;
  v_unresolved jsonb;
  v_inc uuid;
  v_bus text;
  r record;
begin
  if e ? 'trip_id' and nullif(e->>'trip_id','') is not null then
    v_trip := public._device_trip(d, (e->>'trip_id')::uuid);
  end if;

  if v_kind = 'scan' then
    if v_trip.id is null then return jsonb_build_object('ok', false, 'code', 'TRIP_REQUIRED'); end if;
    if v_data ? 'qr' then
      select q.student_id, q.status into v_student, v_status from public._qr_verify(d.org_id, v_data->>'qr') q;
      if v_status <> 'ok' then
        insert into public.scan_events(client_event_id, org_id, trip_id, bus_id, device_id, student_id, method, result,
                                       device_ts, lat, lng, accuracy_m, crew_id, raw)
        values (v_cid, d.org_id, v_trip.id, d.bus_id, d.id, v_student, 'qr', v_status, v_ts, v_lat, v_lng, v_acc, v_crew, left(v_data->>'qr', 120));
        if v_status = 'revoked' then
          perform public._raise_exception(d.org_id, v_trip.id, v_student, d.bus_id, 'REVOKED_CARD_USED', 'medium',
                  'An old (replaced) card was scanned', jsonb_build_object('lat', v_lat, 'lng', v_lng));
        end if;
        return jsonb_build_object('ok', false, 'result', v_status, 'student_id', v_student);
      end if;
    else
      v_student := (v_data->>'student_id')::uuid;
    end if;
    return public._apply_scan(v_trip.id, v_student, nullif(v_data->>'type',''),
                              case when v_data ? 'qr' then 'qr' else 'manual' end,
                              v_ts, v_lat, v_lng, v_acc, v_crew, d.id, v_data->>'reason', v_cid,
                              left(v_data->>'qr', 120), v_data->>'override');

  elsif v_kind = 'resolve' then
    for v_item in select * from jsonb_array_elements(coalesce(v_data->'items', '[]'::jsonb)) loop
      v_res := public._resolve_student(v_trip.id, (v_item->>'student_id')::uuid, v_item->>'resolution',
                                       v_item->>'note', v_ts, 'device', d.id, v_crew,
                                       v_cid || ':' || (v_item->>'student_id'), v_lat, v_lng);
      v_results := v_results || jsonb_build_array(v_res);
    end loop;
    return jsonb_build_object('ok', true, 'items', v_results);

  elsif v_kind = 'arrive' then
    update public.trips set arrived_at = coalesce(arrived_at, v_ts) where id = v_trip.id;
    if v_trip.direction = 'MORNING' and coalesce((v_data->>'bulk_deboard')::boolean, false)
       and coalesce((public.org_setting(d.org_id, 'allow_bulk_deboard'))::boolean, true) then
      for r in select student_id from public.trip_manifest where trip_id = v_trip.id and state = 'ON_BOARD' loop
        v_res := public._apply_scan(v_trip.id, r.student_id, 'DEBOARD', 'bulk', v_ts, v_lat, v_lng, v_acc, v_crew, d.id,
                                    'bulk deboard at school', v_cid || ':' || r.student_id, null, null);
        v_results := v_results || jsonb_build_array(v_res);
      end loop;
    end if;
    return jsonb_build_object('ok', true, 'items', v_results);

  elsif v_kind = 'depart_school' then
    -- explicit reasons from crew first, then everyone still expected becomes MISSED
    for v_item in select * from jsonb_array_elements(coalesce(v_data->'items', '[]'::jsonb)) loop
      v_res := public._resolve_student(v_trip.id, (v_item->>'student_id')::uuid, v_item->>'resolution',
                                       v_item->>'note', v_ts, 'device', d.id, v_crew,
                                       v_cid || ':' || (v_item->>'student_id'), v_lat, v_lng);
      v_results := v_results || jsonb_build_array(v_res);
    end loop;
    perform public._on_school_departure(v_trip.id, v_ts);
    return jsonb_build_object('ok', true, 'items', v_results);

  elsif v_kind = 'empty_check' then
    update public.trips set empty_bus_check = jsonb_build_object(
             'at', v_ts, 'crew_id', v_crew, 'items', coalesce(v_data->'items', '[]'::jsonb),
             'note', v_data->>'note', 'lat', v_lat, 'lng', v_lng)
     where id = v_trip.id;
    return jsonb_build_object('ok', true);

  elsif v_kind = 'complete' then
    select coalesce(jsonb_agg(jsonb_build_object('student_id', m.student_id, 'name', s.first_name, 'state', m.state)), '[]'::jsonb)
      into v_unresolved
      from public.trip_manifest m join public.students s on s.id = m.student_id
     where m.trip_id = v_trip.id and m.state in ('EXPECTED','ON_BOARD');
    if jsonb_array_length(v_unresolved) > 0 then
      return jsonb_build_object('ok', false, 'code', 'UNRESOLVED', 'students', v_unresolved);
    end if;
    select * into v_trip from public.trips where id = v_trip.id;
    if v_trip.empty_bus_check is null then
      return jsonb_build_object('ok', false, 'code', 'EMPTY_BUS_CHECK_REQUIRED');
    end if;
    if v_trip.status = 'active' then
      update public.trips set status = 'completed', completed_at = v_ts where id = v_trip.id;
      update public.bus_live_state set trip_id = null where bus_id = d.bus_id and trip_id = v_trip.id;
      perform public._auto_resolve_exceptions(v_trip.id, null, array['DEVICE_OFFLINE','DROP_NOT_SCANNED'], 'Trip completed');
      perform public._audit(d.org_id, 'device', d.id::text, 'trip_completed', 'trip', v_trip.id::text, null);
    end if;
    return jsonb_build_object('ok', true, 'status', 'completed');

  elsif v_kind = 'sos' then
    insert into public.incidents(org_id, trip_id, bus_id, type, severity, lat, lng, note, crew_id, data)
    values (d.org_id, v_trip.id, d.bus_id, 'sos_' || coalesce(nullif(v_data->>'type',''), 'other'), 'critical',
            v_lat, v_lng, v_data->>'note', v_crew,
            jsonb_build_object('on_board', (select count(*) from public.trip_manifest where trip_id = v_trip.id and state = 'ON_BOARD')))
    returning id into v_inc;
    select display_number into v_bus from public.buses where id = d.bus_id;
    perform public._enqueue_staff(d.org_id, 'SOS', v_inc::text, jsonb_build_object(
      'bus', v_bus, 'type', coalesce(v_data->>'type','other'), 'note', coalesce(v_data->>'note',''),
      'lat', v_lat, 'lng', v_lng, 'time', public._fmt_time(d.org_id, v_ts),
      'on_board', (select count(*) from public.trip_manifest where trip_id = v_trip.id and state = 'ON_BOARD')));
    perform public._audit(d.org_id, 'device', d.id::text, 'sos', 'incident', v_inc::text, v_data);
    return jsonb_build_object('ok', true, 'incident_id', v_inc);

  elsif v_kind = 'delay' then
    insert into public.incidents(org_id, trip_id, bus_id, type, severity, lat, lng, note, crew_id, data)
    values (d.org_id, v_trip.id, d.bus_id, 'delay', 'low', v_lat, v_lng, v_data->>'reason', v_crew,
            jsonb_build_object('minutes', v_data->>'minutes'))
    returning id into v_inc;
    return jsonb_build_object('ok', true, 'incident_id', v_inc);
  end if;

  return jsonb_build_object('ok', false, 'code', 'UNKNOWN_KIND');
end $$;
revoke all on function public._dev_event(public.devices, jsonb) from public, anon, authenticated;

create or replace function public.dev_sync(p_token text, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.devices%rowtype; e jsonb; v_prev jsonb; v_res jsonb; v_out jsonb := '[]'::jsonb;
begin
  d := public._device_auth(p_token);
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    select result into v_prev from public.device_events where client_event_id = e->>'id';
    if found then
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', e->>'id', 'replayed', true) || coalesce(v_prev, '{}'::jsonb));
      continue;
    end if;
    begin
      v_res := public._dev_event(d, e);
    exception when others then
      v_res := jsonb_build_object('ok', false, 'code', 'ERROR', 'message', sqlerrm);
    end;
    insert into public.device_events(client_event_id, device_id, kind, result)
    values (e->>'id', d.id, coalesce(e->>'kind','?'), v_res)
    on conflict (client_event_id) do nothing;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', e->>'id') || v_res);
  end loop;
  return jsonb_build_object('results', v_out, 'server_ts', now());
end $$;

-- ---------------------------------------------------------------------
-- Locations: batch of GPS points; updates live state, geofences, speed
-- point = {ts, lat, lng, acc, speed (m/s), heading}
-- ---------------------------------------------------------------------
create or replace function public.dev_locations(p_token text, p_trip_id uuid, p_points jsonb, p_battery int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.devices%rowtype; t public.trips%rowtype;
  p jsonb; v_last_ts timestamptz; v_ts timestamptz; v_lat double precision; v_lng double precision;
  v_acc double precision; v_speed double precision; v_heading double precision;
  v_stored int := 0; v_overspeed int; v_campus record; v_dist double precision; s record; v_visit record;
  v_final jsonb;
begin
  d := public._device_auth(p_token);
  if p_trip_id is not null then
    t := public._device_trip(d, p_trip_id);
  end if;
  v_overspeed := coalesce((public.org_setting(d.org_id, 'overspeed_kmh'))::int, 40);
  if t.id is not null then
    select max(ts) into v_last_ts from public.location_points where trip_id = t.id;
    select c.lat, c.lng, c.geofence_radius_m as radius into v_campus from public.campuses c
      join public.routes r on r.id = t.route_id
     where c.org_id = t.org_id order by (c.id = r.campus_id) desc, c.created_at limit 1;
  end if;

  for p in select value from jsonb_array_elements(coalesce(p_points,'[]'::jsonb)) order by (value->>'ts')::timestamptz loop
    v_ts := least((p->>'ts')::timestamptz, now());
    v_lat := (p->>'lat')::double precision; v_lng := (p->>'lng')::double precision;
    v_acc := (p->>'acc')::double precision;
    v_speed := round(((p->>'speed')::double precision * 3.6)::numeric, 1);
    v_heading := (p->>'heading')::double precision;
    if v_lat is null or v_lng is null then continue; end if;
    v_final := p;

    -- store at most one point per 12 s
    if v_last_ts is null or v_ts >= v_last_ts + interval '12 seconds' then
      insert into public.location_points(org_id, trip_id, bus_id, ts, lat, lng, speed_kmh, heading, accuracy_m)
      values (d.org_id, t.id, d.bus_id, v_ts, v_lat, v_lng, v_speed, v_heading, v_acc);
      v_last_ts := v_ts; v_stored := v_stored + 1;
    end if;

    if t.id is null or t.status <> 'active' or coalesce(v_acc, 0) > 80 then continue; end if;

    -- stop geofences (enter at r, exit at r + 25 m)
    for s in select st.id, st.lat, st.lng, st.radius_m from public.route_stops rs join public.stops st on st.id = rs.stop_id
              where rs.route_id = t.route_id loop
      v_dist := public.geo_dist_m(v_lat, v_lng, s.lat, s.lng);
      select * into v_visit from public.trip_stop_visits where trip_id = t.id and stop_id = s.id;
      if not found then
        if v_dist <= s.radius_m then
          insert into public.trip_stop_visits(trip_id, stop_id, entered_at) values (t.id, s.id, v_ts) on conflict do nothing;
        end if;
      elsif v_visit.exited_at is null and v_dist > s.radius_m + 25 then
        update public.trip_stop_visits set exited_at = v_ts where trip_id = t.id and stop_id = s.id;
        perform public._on_stop_exit(t.id, s.id, v_ts);
      end if;
    end loop;

    -- school geofence
    if v_campus.lat is not null then
      v_dist := public.geo_dist_m(v_lat, v_lng, v_campus.lat, v_campus.lng);
      if t.direction = 'MORNING' and v_dist <= v_campus.radius then
        update public.trips set arrived_at = coalesce(arrived_at, v_ts) where id = t.id and arrived_at is null;
      elsif t.direction = 'AFTERNOON' and v_dist > v_campus.radius + 50 then
        select * into t from public.trips where id = t.id;
        if t.departed_school_at is null then
          perform public._on_school_departure(t.id, v_ts);
        end if;
      end if;
    end if;

    -- overspeed (one incident per 5 minutes per trip)
    if v_speed > v_overspeed and not exists (
         select 1 from public.incidents i where i.trip_id = t.id and i.type = 'overspeed' and i.created_at > now() - interval '5 minutes') then
      insert into public.incidents(org_id, trip_id, bus_id, type, severity, lat, lng, note, data)
      values (d.org_id, t.id, d.bus_id, 'overspeed', 'medium', v_lat, v_lng,
              'Speed ' || v_speed || ' km/h (limit ' || v_overspeed || ')', jsonb_build_object('speed_kmh', v_speed));
    end if;
  end loop;

  if v_final is not null then
    insert into public.bus_live_state(bus_id, org_id, trip_id, lat, lng, heading, speed_kmh, accuracy_m, battery, recorded_at, updated_at)
    values (d.bus_id, d.org_id, t.id, (v_final->>'lat')::double precision, (v_final->>'lng')::double precision,
            (v_final->>'heading')::double precision, round(((v_final->>'speed')::double precision * 3.6)::numeric, 1),
            (v_final->>'acc')::double precision, p_battery, least((v_final->>'ts')::timestamptz, now()), now())
    on conflict (bus_id) do update set trip_id = excluded.trip_id, lat = excluded.lat, lng = excluded.lng,
      heading = excluded.heading, speed_kmh = excluded.speed_kmh, accuracy_m = excluded.accuracy_m,
      battery = coalesce(excluded.battery, bus_live_state.battery), recorded_at = excluded.recorded_at, updated_at = now();
    if t.id is not null then
      perform public._auto_resolve_exceptions(t.id, null, array['DEVICE_OFFLINE'], 'Device back online');
    end if;
  end if;
  update public.devices set battery = coalesce(p_battery, battery) where id = d.id;
  return jsonb_build_object('ok', true, 'stored', v_stored);
end $$;

create or replace function public.dev_heartbeat(p_token text, p_info jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.devices%rowtype;
begin
  d := public._device_auth(p_token);
  update public.devices set battery = coalesce((p_info->>'battery')::int, battery),
         gps_enabled = coalesce((p_info->>'gps_enabled')::boolean, gps_enabled),
         pending_queue = coalesce((p_info->>'pending')::int, pending_queue),
         app_version = coalesce(p_info->>'app_version', app_version)
   where id = d.id;
  return jsonb_build_object('server_ts', now(), 'min_app_version', public.org_setting(d.org_id, 'min_app_version') #>> '{}');
end $$;

grant execute on function public.dev_pair(text, jsonb), public.dev_bootstrap(text), public.dev_trip_data(text, uuid),
  public.dev_start_trip(text, uuid, uuid, uuid, double precision, double precision, timestamptz),
  public.dev_sync(text, jsonb), public.dev_locations(text, uuid, jsonb, int), public.dev_heartbeat(text, jsonb)
  to anon, authenticated;
