-- =====================================================================
-- Admin dashboard RPCs (called by signed-in school staff)
-- =====================================================================

create or replace function public._require_writer() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := public.my_org();
  if v_org is null then raise exception 'NOT_IN_ORGANIZATION' using errcode = '42501'; end if;
  if not public.can_write() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return v_org;
end $$;
revoke all on function public._require_writer() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Onboarding: a signed-in user without an org creates their school.
-- ---------------------------------------------------------------------
create or replace function public.create_organization(p_name text, p_short_code text, p_campus_name text,
                                                      p_lat double precision, p_lng double precision,
                                                      p_user_name text default null, p_desk_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_email text;
begin
  if v_uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if exists (select 1 from public.org_users where user_id = v_uid) then
    raise exception 'ALREADY_IN_ORGANIZATION' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = v_uid;
  insert into public.organizations(name, short_code) values (trim(p_name), upper(trim(p_short_code))) returning id into v_org;
  insert into public.org_secrets(org_id) values (v_org);
  insert into public.campuses(org_id, name, lat, lng, desk_phone) values (v_org, coalesce(nullif(trim(p_campus_name),''), trim(p_name)), p_lat, p_lng, p_desk_phone);
  insert into public.org_users(user_id, org_id, role, name, email) values (v_uid, v_org, 'school_admin', p_user_name, v_email);
  perform public._audit(v_org, 'user', v_uid::text, 'org_created', 'organization', v_org::text, null);
  return v_org;
end $$;

-- ---------------------------------------------------------------------
-- QR credentials
-- ---------------------------------------------------------------------
create or replace function public.issue_credentials(p_student_ids uuid[], p_reissue boolean default false)
returns table(student_id uuid, payload text, version int)
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer();
begin
  if p_reissue then
    update public.students s set cred_version = s.cred_version + 1
     where s.id = any(p_student_ids) and s.org_id = v_org;
    insert into public.credential_history(org_id, student_id, version, issued_by)
    select v_org, s.id, s.cred_version, auth.uid() from public.students s where s.id = any(p_student_ids) and s.org_id = v_org;
    perform public._audit(v_org, 'user', auth.uid()::text, 'credentials_reissued', 'students', null, to_jsonb(p_student_ids));
  end if;
  return query
    select s.id, public._qr_payload(s.id), s.cred_version from public.students s
     where s.id = any(p_student_ids) and s.org_id = v_org;
end $$;

-- ---------------------------------------------------------------------
-- Devices & crew
-- ---------------------------------------------------------------------
create or replace function public.create_pairing_code(p_bus_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer(); v_code text;
begin
  if not exists (select 1 from public.buses where id = p_bus_id and org_id = v_org) then
    raise exception 'BUS_NOT_FOUND' using errcode = 'P0001';
  end if;
  delete from public.pairing_codes where bus_id = p_bus_id and used_at is null;
  v_code := public.random_code(8);
  insert into public.pairing_codes(code, org_id, bus_id, created_by) values (v_code, v_org, p_bus_id, auth.uid());
  return jsonb_build_object('code', v_code, 'expires_at', now() + interval '15 minutes');
end $$;

create or replace function public.revoke_device(p_device_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer();
begin
  update public.devices set revoked_at = now() where id = p_device_id and org_id = v_org;
  perform public._audit(v_org, 'user', auth.uid()::text, 'device_revoked', 'device', p_device_id::text, null);
end $$;

create or replace function public.set_crew_pin(p_crew_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer();
begin
  if p_pin !~ '^\d{4,6}$' then raise exception 'PIN_MUST_BE_4_TO_6_DIGITS' using errcode = 'P0001'; end if;
  update public.crew_members set pin_hash = public.sha256_hex(p_crew_id::text || ':' || p_pin)
   where id = p_crew_id and org_id = v_org;
end $$;

-- ---------------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------------
create or replace function public.generate_trips(p_date date default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer();
begin
  return public.generate_trips_for_org(v_org, coalesce(p_date, public._org_today(v_org)));
end $$;

create or replace function public.set_assignment(p_student_id uuid, p_direction text, p_route_id uuid, p_stop_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer(); v_today date; v_existing public.transport_assignments%rowtype;
begin
  v_today := public._org_today(v_org);
  if not exists (select 1 from public.students where id = p_student_id and org_id = v_org) then
    raise exception 'STUDENT_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into v_existing from public.transport_assignments
   where student_id = p_student_id and direction = p_direction and effective_to is null;
  if p_route_id is null then
    if v_existing.id is not null then
      if v_existing.effective_from >= v_today then delete from public.transport_assignments where id = v_existing.id;
      else update public.transport_assignments set effective_to = v_today - 1 where id = v_existing.id; end if;
    end if;
    return;
  end if;
  if not exists (select 1 from public.routes r join public.route_stops rs on rs.route_id = r.id
                  where r.id = p_route_id and r.org_id = v_org and r.direction = p_direction and rs.stop_id = p_stop_id) then
    raise exception 'STOP_NOT_ON_ROUTE' using errcode = 'P0001';
  end if;
  if v_existing.id is not null then
    if v_existing.route_id = p_route_id and v_existing.stop_id = p_stop_id then return; end if;
    if v_existing.effective_from >= v_today then
      update public.transport_assignments set route_id = p_route_id, stop_id = p_stop_id where id = v_existing.id;
      return;
    end if;
    update public.transport_assignments set effective_to = v_today - 1 where id = v_existing.id;
  end if;
  insert into public.transport_assignments(org_id, student_id, direction, route_id, stop_id, effective_from)
  values (v_org, p_student_id, p_direction, p_route_id, p_stop_id, v_today);
end $$;

create or replace function public.admin_mark_scan(p_trip_id uuid, p_student_id uuid, p_type text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer(); v_res jsonb;
begin
  if not exists (select 1 from public.trips where id = p_trip_id and org_id = v_org) then raise exception 'TRIP_NOT_FOUND'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  v_res := public._apply_scan(p_trip_id, p_student_id, p_type, 'admin', now(), null, null, null, null, null, p_reason,
                              null, null, 'allow_wrong_bus');
  perform public._audit(v_org, 'user', auth.uid()::text, 'admin_mark_scan', 'trip', p_trip_id::text,
                        jsonb_build_object('student_id', p_student_id, 'type', p_type, 'reason', p_reason, 'result', v_res));
  return v_res;
end $$;

create or replace function public.admin_resolve_student(p_trip_id uuid, p_student_id uuid, p_resolution text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer();
begin
  if not exists (select 1 from public.trips where id = p_trip_id and org_id = v_org) then raise exception 'TRIP_NOT_FOUND'; end if;
  return public._resolve_student(p_trip_id, p_student_id, p_resolution, p_note, now(), 'admin', null, null, null, null, null);
end $$;

create or replace function public.force_complete_trip(p_trip_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer(); v_trip public.trips%rowtype; r record; v_n int := 0;
begin
  select * into v_trip from public.trips where id = p_trip_id and org_id = v_org;
  if not found then raise exception 'TRIP_NOT_FOUND'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  for r in select student_id, state from public.trip_manifest where trip_id = p_trip_id and state in ('EXPECTED','ON_BOARD') loop
    if r.state = 'ON_BOARD' then
      perform public._resolve_student(p_trip_id, r.student_id, 'unconfirmed', p_reason, now(), 'admin', null, null, null, null, null);
    else
      update public.trip_manifest set state = 'NO_SHOW', state_at = now(), resolved_reason = 'trip force-completed'
       where trip_id = p_trip_id and student_id = r.student_id;
    end if;
    v_n := v_n + 1;
  end loop;
  update public.trips set status = 'completed_forced', completed_at = now(), completion_reason = p_reason where id = p_trip_id;
  update public.bus_live_state set trip_id = null where trip_id = p_trip_id;
  perform public._audit(v_org, 'user', auth.uid()::text, 'trip_force_completed', 'trip', p_trip_id::text,
                        jsonb_build_object('reason', p_reason, 'unresolved', v_n));
  return jsonb_build_object('ok', true, 'unresolved_marked', v_n);
end $$;

create or replace function public.cancel_trip(p_trip_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer();
begin
  update public.trips set status = 'cancelled', completion_reason = p_reason
   where id = p_trip_id and org_id = v_org and status = 'scheduled';
  if not found then raise exception 'ONLY_SCHEDULED_TRIPS_CAN_BE_CANCELLED' using errcode = 'P0001'; end if;
  perform public._audit(v_org, 'user', auth.uid()::text, 'trip_cancelled', 'trip', p_trip_id::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.transfer_riders(p_from_trip uuid, p_to_trip uuid, p_student_ids uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer(); r record; v_n int := 0; v_from_bus text;
begin
  if not exists (select 1 from public.trips where id = p_from_trip and org_id = v_org)
     or not exists (select 1 from public.trips where id = p_to_trip and org_id = v_org) then
    raise exception 'TRIP_NOT_FOUND'; end if;
  select b.display_number into v_from_bus from public.trips t left join public.buses b on b.id = t.bus_id where t.id = p_from_trip;
  for r in select * from public.trip_manifest where trip_id = p_from_trip
            and state in ('EXPECTED','ON_BOARD','MISSED')
            and (p_student_ids is null or student_id = any(p_student_ids)) loop
    insert into public.trip_manifest(org_id, trip_id, student_id, stop_id, state, board_at, is_guest, resolved_reason)
    values (v_org, p_to_trip, r.student_id, r.stop_id, case when r.state = 'ON_BOARD' then 'ON_BOARD' else 'EXPECTED' end,
            r.board_at, true, 'transferred')
    on conflict (trip_id, student_id) do update set state = excluded.state, board_at = excluded.board_at;
    update public.trip_manifest set state = 'TRANSFERRED', state_at = now(), transferred_to = p_to_trip
     where trip_id = p_from_trip and student_id = r.student_id;
    perform public._enqueue_student_event('BUS_CHANGED', p_to_trip, r.student_id, now(),
            jsonb_build_object('usual_bus', coalesce(v_from_bus, '')));
    v_n := v_n + 1;
  end loop;
  perform public._audit(v_org, 'user', auth.uid()::text, 'riders_transferred', 'trip', p_from_trip::text,
                        jsonb_build_object('to', p_to_trip, 'count', v_n));
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Exceptions & incidents
-- ---------------------------------------------------------------------
create or replace function public.ack_exception(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer();
begin
  update public.exceptions set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid()
   where id = p_id and org_id = v_org and status = 'open';
end $$;

create or replace function public.resolve_exception(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer();
begin
  if coalesce(trim(p_note), '') = '' then raise exception 'NOTE_REQUIRED' using errcode = 'P0001'; end if;
  update public.exceptions set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_note = p_note,
         acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where id = p_id and org_id = v_org and status <> 'resolved';
end $$;

create or replace function public.ack_incident(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer();
begin
  update public.incidents set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid()
   where id = p_id and org_id = v_org and status = 'open';
end $$;

create or replace function public.resolve_incident(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer();
begin
  update public.incidents set status = 'resolved', resolved_at = now(), resolution_note = p_note,
         acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where id = p_id and org_id = v_org;
end $$;

-- Admin-approved broadcast to parents of students on a trip (incident updates, delays)
create or replace function public.broadcast_trip(p_trip_id uuid, p_message text) returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer(); r record; v_n int := 0; v_key text := public.random_code(6);
begin
  if not exists (select 1 from public.trips where id = p_trip_id and org_id = v_org) then raise exception 'TRIP_NOT_FOUND'; end if;
  for r in select student_id from public.trip_manifest where trip_id = p_trip_id
            and state not in ('ABSENT_NOTIFIED','TRANSFERRED','NO_SHOW') loop
    v_n := v_n + public._enqueue_student_event('INCIDENT', p_trip_id, r.student_id, now(),
             jsonb_build_object('message', p_message, 'dedupe_suffix', v_key));
  end loop;
  perform public._audit(v_org, 'user', auth.uid()::text, 'broadcast', 'trip', p_trip_id::text, jsonb_build_object('message', p_message));
  return v_n;
end $$;

-- WhatsApp opt-in: send welcome template to guardians that have a WhatsApp channel
create or replace function public.send_optin(p_guardian_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer(); r record; v_n int := 0; v_school text;
begin
  select name into v_school from public.organizations where id = v_org;
  for r in select g.id, g.name, g.language, gc.address,
                  (select string_agg(s.first_name, ', ') from public.student_guardians sg join public.students s on s.id = sg.student_id
                    where sg.guardian_id = g.id) as children
             from public.guardians g join public.guardian_channels gc on gc.guardian_id = g.id and gc.channel = 'whatsapp'
            where g.id = any(p_guardian_ids) and g.org_id = v_org loop
    insert into public.notification_outbox(org_id, event_type, dedupe_key, guardian_id, channel, address, language, payload)
    values (v_org, 'WELCOME', 'WELCOME:' || r.id || ':' || public.random_code(4), r.id, 'whatsapp', r.address, r.language,
            jsonb_build_object('guardian_name', r.name, 'school', v_school, 'children', coalesce(r.children, '')))
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Bulk import of students (+ guardians + assignments)
-- rows: [{admission_no, first_name, last_name, class, section, guardian_name, guardian_phone,
--         guardian_relation, guardian_language, am_route, am_stop, pm_route, pm_stop, special_care}]
-- ---------------------------------------------------------------------
create or replace function public.import_students(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public._require_writer(); r jsonb; i int := 0; v_student uuid; v_guardian uuid;
  v_ins int := 0; v_upd int := 0; v_errors jsonb := '[]'::jsonb; v_route uuid; v_stop uuid; v_phone text; v_campus uuid;
  v_dir text; v_rk text; v_sk text; v_is_new boolean;
begin
  select id into v_campus from public.campuses where org_id = v_org order by created_at limit 1;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      if coalesce(trim(r->>'first_name'), '') = '' then raise exception 'first_name is required'; end if;
      v_student := null;
      if coalesce(trim(r->>'admission_no'), '') <> '' then
        select id into v_student from public.students where org_id = v_org and admission_no = trim(r->>'admission_no');
      end if;
      if v_student is null then
        insert into public.students(org_id, campus_id, admission_no, first_name, last_name, class_name, section, special_care_note)
        values (v_org, v_campus, nullif(trim(r->>'admission_no'),''), trim(r->>'first_name'), coalesce(trim(r->>'last_name'),''),
                nullif(trim(r->>'class'),''), nullif(trim(r->>'section'),''), nullif(left(trim(r->>'special_care'),60),''))
        returning id into v_student;
        v_is_new := true;
      else
        update public.students set first_name = trim(r->>'first_name'), last_name = coalesce(trim(r->>'last_name'), last_name),
               class_name = coalesce(nullif(trim(r->>'class'),''), class_name), section = coalesce(nullif(trim(r->>'section'),''), section)
         where id = v_student;
        v_is_new := false;
      end if;

      v_phone := regexp_replace(coalesce(r->>'guardian_phone', ''), '[^0-9+]', '', 'g');
      if v_phone <> '' then
        if v_phone !~ '^\+' then
          v_phone := case when length(v_phone) = 10 then '+91' || v_phone else '+' || v_phone end;
        end if;
        select id into v_guardian from public.guardians where org_id = v_org and phone = v_phone limit 1;
        if v_guardian is null then
          insert into public.guardians(org_id, name, relation, phone, language)
          values (v_org, coalesce(nullif(trim(r->>'guardian_name'),''), 'Parent'), nullif(trim(r->>'guardian_relation'),''), v_phone,
                  case when r->>'guardian_language' in ('en','hi','te') then r->>'guardian_language' else 'en' end)
          returning id into v_guardian;
        end if;
        insert into public.student_guardians(org_id, student_id, guardian_id, is_primary)
        values (v_org, v_student, v_guardian, true) on conflict do nothing;
      end if;

      foreach v_dir in array array['MORNING','AFTERNOON'] loop
        v_rk := case when v_dir = 'MORNING' then 'am_route' else 'pm_route' end;
        v_sk := case when v_dir = 'MORNING' then 'am_stop' else 'pm_stop' end;
        if coalesce(trim(r->>v_rk), '') <> '' then
          select id into v_route from public.routes where org_id = v_org and upper(code) = upper(trim(r->>v_rk)) and direction = v_dir;
          if v_route is null then raise exception 'route % (%) not found', r->>v_rk, v_dir; end if;
          select s.id into v_stop from public.route_stops rs join public.stops s on s.id = rs.stop_id
           where rs.route_id = v_route and lower(s.name) = lower(trim(r->>v_sk)) limit 1;
          if v_stop is null then raise exception 'stop "%" not on route %', r->>v_sk, r->>v_rk; end if;
          delete from public.transport_assignments where student_id = v_student and direction = v_dir and effective_to is null;
          insert into public.transport_assignments(org_id, student_id, direction, route_id, stop_id)
          values (v_org, v_student, v_dir, v_route, v_stop);
        end if;
      end loop;
      if v_is_new then v_ins := v_ins + 1; else v_upd := v_upd + 1; end if;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', i, 'error', sqlerrm));
    end;
  end loop;
  perform public._audit(v_org, 'user', auth.uid()::text, 'students_imported', 'students', null,
                        jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'errors', jsonb_array_length(v_errors)));
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'errors', v_errors);
end $$;

-- ---------------------------------------------------------------------
-- Live board & journeys
-- ---------------------------------------------------------------------
create or replace function public.live_board() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.my_org(); v_today date; v_buses jsonb; v_kpi jsonb; v_offline int;
begin
  if v_org is null then raise exception 'NOT_IN_ORGANIZATION' using errcode = '42501'; end if;
  v_today := public._org_today(v_org);
  v_offline := coalesce((public.org_setting(v_org, 'device_offline_min'))::int, 3);

  select coalesce(jsonb_agg(x order by x->>'display_number'), '[]'::jsonb) into v_buses from (
    select jsonb_build_object(
      'bus_id', b.id, 'display_number', b.display_number, 'registration_no', b.registration_no, 'status', b.status,
      'live', (select to_jsonb(l) - 'org_id' from public.bus_live_state l where l.bus_id = b.id),
      'device', (select jsonb_build_object('id', d.id, 'last_seen_at', d.last_seen_at, 'battery', d.battery, 'app_version', d.app_version)
                   from public.devices d where d.bus_id = b.id and d.revoked_at is null order by d.paired_at desc limit 1),
      'trips', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', t.id, 'direction', t.direction, 'status', t.status, 'route_code', r.code, 'route_name', r.name,
                  'scheduled_start', t.scheduled_start, 'started_at', t.started_at, 'completed_at', t.completed_at,
                  'driver', (select name from public.crew_members where id = t.driver_id),
                  'attendant', (select name from public.crew_members where id = t.attendant_id),
                  'expected', (select count(*) from public.trip_manifest m where m.trip_id = t.id and m.state not in ('ABSENT_NOTIFIED','TRANSFERRED')),
                  'on_board', (select count(*) from public.trip_manifest m where m.trip_id = t.id and m.state = 'ON_BOARD'),
                  'dropped', (select count(*) from public.trip_manifest m where m.trip_id = t.id and m.state in ('DROPPED','HANDED_OVER')),
                  'missing', (select count(*) from public.trip_manifest m where m.trip_id = t.id and m.state in ('MISSED','UNCONFIRMED')),
                  'waiting', (select count(*) from public.trip_manifest m where m.trip_id = t.id and m.state = 'EXPECTED'),
                  'stops_done', (select count(*) from public.trip_stop_visits v where v.trip_id = t.id),
                  'stops_total', (select count(*) from public.route_stops rs where rs.route_id = t.route_id)
                ) order by t.scheduled_start), '[]'::jsonb)
                from public.trips t join public.routes r on r.id = t.route_id
               where t.bus_id = b.id and t.trip_date = v_today and t.status <> 'cancelled')
    ) as x
    from public.buses b where b.org_id = v_org and b.status <> 'retired'
  ) q;

  select jsonb_build_object(
    'active_trips', (select count(*) from public.trips where org_id = v_org and trip_date = v_today and status = 'active'),
    'scheduled_trips', (select count(*) from public.trips where org_id = v_org and trip_date = v_today and status = 'scheduled'),
    'late_trips', (select count(*) from public.trips where org_id = v_org and trip_date = v_today and status = 'scheduled'
                     and scheduled_start < now() - make_interval(mins => coalesce((public.org_setting(v_org,'late_start_min'))::int, 10))),
    'on_board', (select count(*) from public.trip_manifest m join public.trips t on t.id = m.trip_id
                  where t.org_id = v_org and t.trip_date = v_today and t.status = 'active' and m.state = 'ON_BOARD'),
    'not_boarded', (select count(*) from public.trip_manifest m join public.trips t on t.id = m.trip_id
                  where t.org_id = v_org and t.trip_date = v_today and m.state in ('MISSED','UNCONFIRMED')),
    'open_exceptions', (select count(*) from public.exceptions where org_id = v_org and status <> 'resolved'),
    'open_incidents', (select count(*) from public.incidents where org_id = v_org and status <> 'resolved' and type like 'sos%'),
    'offline_buses', (select count(*) from public.trips t join public.bus_live_state l on l.bus_id = t.bus_id
                       where t.org_id = v_org and t.trip_date = v_today and t.status = 'active'
                         and l.updated_at < now() - make_interval(mins => v_offline))
  ) into v_kpi;

  return jsonb_build_object('today', v_today, 'server_ts', now(), 'kpi', v_kpi, 'buses', v_buses);
end $$;

create or replace function public.where_is_student(p_student_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.my_org(); v_res jsonb;
begin
  select jsonb_build_object('trip_id', t.id, 'direction', t.direction, 'trip_status', t.status, 'state', m.state,
                            'state_at', m.state_at, 'bus', b.display_number, 'live', to_jsonb(l) - 'org_id')
    into v_res
    from public.trip_manifest m join public.trips t on t.id = m.trip_id
    left join public.buses b on b.id = t.bus_id
    left join public.bus_live_state l on l.bus_id = t.bus_id
   where m.student_id = p_student_id and t.org_id = v_org and t.trip_date = public._org_today(v_org)
   order by t.scheduled_start desc limit 1;
  return coalesce(v_res, jsonb_build_object('state', 'NO_TRIP_TODAY'));
end $$;

create or replace function public.student_journey(p_student_id uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'trip_id', t.id, 'date', t.trip_date, 'direction', t.direction, 'route', r.code, 'bus', b.display_number,
    'state', m.state, 'board_at', m.board_at, 'drop_at', m.drop_at, 'reason', m.resolved_reason,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('type', e.type, 'method', e.method, 'result', e.result,
                 'at', coalesce(e.device_ts, e.server_ts), 'stop', st.name, 'lat', e.lat, 'lng', e.lng) order by e.server_ts), '[]'::jsonb)
               from public.scan_events e left join public.stops st on st.id = e.stop_id
              where e.trip_id = t.id and e.student_id = p_student_id)
  ) order by t.trip_date desc, t.scheduled_start desc), '[]'::jsonb)
  from public.trip_manifest m
  join public.trips t on t.id = m.trip_id and t.org_id = public.my_org()
  join public.routes r on r.id = t.route_id
  left join public.buses b on b.id = t.bus_id
  where m.student_id = p_student_id and t.trip_date between p_from and p_to
$$;

-- ---------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------
create or replace function public.report_daily_attendance(p_date date) returns table(
  student_id uuid, admission_no text, name text, class text,
  am_route text, am_state text, am_board timestamptz, am_drop timestamptz,
  pm_route text, pm_state text, pm_board timestamptz, pm_drop timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.admission_no, s.first_name || ' ' || s.last_name, concat_ws('-', s.class_name, s.section),
         am.code, am.state, am.board_at, am.drop_at, pm.code, pm.state, pm.board_at, pm.drop_at
    from public.students s
    left join lateral (select r.code, m.state, m.board_at, m.drop_at from public.trip_manifest m
                         join public.trips t on t.id = m.trip_id join public.routes r on r.id = t.route_id
                        where m.student_id = s.id and t.trip_date = p_date and t.direction = 'MORNING'
                          and m.state <> 'TRANSFERRED' limit 1) am on true
    left join lateral (select r.code, m.state, m.board_at, m.drop_at from public.trip_manifest m
                         join public.trips t on t.id = m.trip_id join public.routes r on r.id = t.route_id
                        where m.student_id = s.id and t.trip_date = p_date and t.direction = 'AFTERNOON'
                          and m.state <> 'TRANSFERRED' limit 1) pm on true
   where s.org_id = public.my_org() and (am.state is not null or pm.state is not null)
   order by s.class_name, s.section, s.first_name
$$;

create or replace function public.report_trip_performance(p_from date, p_to date) returns table(
  trip_id uuid, trip_date date, direction text, route text, bus text, status text,
  scheduled_start timestamptz, started_at timestamptz, completed_at timestamptz, start_delay_min numeric,
  duration_min numeric, expected bigint, scanned_board bigint, scanned_drop bigint, manual_marks bigint,
  exceptions bigint, empty_bus_check boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.trip_date, t.direction, r.code, b.display_number, t.status, t.scheduled_start, t.started_at, t.completed_at,
         round(extract(epoch from (t.started_at - t.scheduled_start)) / 60.0, 1),
         round(extract(epoch from (t.completed_at - t.started_at)) / 60.0, 1),
         (select count(*) from public.trip_manifest m where m.trip_id = t.id and m.state not in ('ABSENT_NOTIFIED','TRANSFERRED')),
         (select count(distinct e.student_id) from public.scan_events e where e.trip_id = t.id and e.type = 'BOARD' and e.result = 'ok'),
         (select count(distinct e.student_id) from public.scan_events e where e.trip_id = t.id and e.type = 'DEBOARD' and e.result = 'ok'),
         (select count(*) from public.scan_events e where e.trip_id = t.id and e.result = 'ok' and e.method in ('manual','admin')),
         (select count(*) from public.exceptions x where x.trip_id = t.id),
         t.empty_bus_check is not null
    from public.trips t join public.routes r on r.id = t.route_id left join public.buses b on b.id = t.bus_id
   where t.org_id = public.my_org() and t.trip_date between p_from and p_to
   order by t.trip_date desc, t.scheduled_start
$$;

create or replace function public.report_exceptions_summary(p_from date, p_to date) returns table(
  code text, severity text, total bigint, open bigint, avg_resolution_min numeric)
language sql stable security definer set search_path = public as $$
  select x.code, x.severity, count(*), count(*) filter (where x.status <> 'resolved'),
         round(avg(extract(epoch from (x.resolved_at - x.opened_at)) / 60.0) filter (where x.resolved_at is not null), 1)
    from public.exceptions x
   where x.org_id = public.my_org() and (x.opened_at at time zone 'Asia/Kolkata')::date between p_from and p_to
   group by x.code, x.severity order by count(*) desc
$$;

create or replace function public.report_scan_compliance(p_from date, p_to date) returns table(
  bus text, trips bigint, riders bigint, board_scanned bigint, drop_scanned bigint, manual bigint, compliance_pct numeric)
language sql stable security definer set search_path = public as $$
  with riders as (
    select t.bus_id, t.id as trip_id, m.student_id,
           exists (select 1 from public.scan_events e where e.trip_id = t.id and e.student_id = m.student_id and e.type='BOARD' and e.result='ok' and e.method='qr') as b_qr,
           exists (select 1 from public.scan_events e where e.trip_id = t.id and e.student_id = m.student_id and e.type='DEBOARD' and e.result='ok' and e.method in ('qr','bulk')) as d_qr,
           exists (select 1 from public.scan_events e where e.trip_id = t.id and e.student_id = m.student_id and e.result='ok' and e.method in ('manual','admin')) as manual
      from public.trips t join public.trip_manifest m on m.trip_id = t.id
     where t.org_id = public.my_org() and t.trip_date between p_from and p_to
       and m.state in ('DROPPED','HANDED_OVER','ON_BOARD','UNCONFIRMED')
  )
  select b.display_number, count(distinct r.trip_id), count(*), count(*) filter (where b_qr), count(*) filter (where d_qr),
         count(*) filter (where manual),
         round(100.0 * count(*) filter (where b_qr and d_qr) / nullif(count(*), 0), 1)
    from riders r left join public.buses b on b.id = r.bus_id
   group by b.display_number order by b.display_number
$$;

create or replace function public.report_notifications(p_from date, p_to date) returns table(
  channel text, event_type text, total bigint, delivered bigint, failed bigint, queued bigint)
language sql stable security definer set search_path = public as $$
  select o.channel, o.event_type, count(*),
         count(*) filter (where o.status in ('sent','delivered','read')),
         count(*) filter (where o.status = 'failed'),
         count(*) filter (where o.status in ('queued','sending'))
    from public.notification_outbox o
   where o.org_id = public.my_org() and (o.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
   group by o.channel, o.event_type order by o.channel, count(*) desc
$$;

create or replace function public.report_safety(p_from date, p_to date) returns table(
  bus text, overspeed bigint, sos bigint, delays bigint, empty_check_missing bigint, max_speed numeric)
language sql stable security definer set search_path = public as $$
  select b.display_number,
         (select count(*) from public.incidents i where i.bus_id = b.id and i.type = 'overspeed' and (i.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
         (select count(*) from public.incidents i where i.bus_id = b.id and i.type like 'sos%' and (i.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
         (select count(*) from public.incidents i where i.bus_id = b.id and i.type = 'delay' and (i.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
         (select count(*) from public.trips t where t.bus_id = b.id and t.trip_date between p_from and p_to
             and t.status in ('completed_forced','aborted_auto') and t.empty_bus_check is null),
         (select max(lp.speed_kmh)::numeric from public.location_points lp join public.trips t on t.id = lp.trip_id
           where lp.bus_id = b.id and t.trip_date between p_from and p_to)
    from public.buses b where b.org_id = public.my_org() order by b.display_number
$$;

-- grants: dashboard functions callable by signed-in users (they check org/role inside)
do $$
declare f text;
begin
  foreach f in array array[
    'create_organization(text,text,text,double precision,double precision,text,text)',
    'issue_credentials(uuid[],boolean)', 'create_pairing_code(uuid)', 'revoke_device(uuid)', 'set_crew_pin(uuid,text)',
    'generate_trips(date)', 'set_assignment(uuid,text,uuid,uuid)', 'admin_mark_scan(uuid,uuid,text,text)',
    'admin_resolve_student(uuid,uuid,text,text)', 'force_complete_trip(uuid,text)', 'cancel_trip(uuid,text)',
    'transfer_riders(uuid,uuid,uuid[])', 'ack_exception(uuid)', 'resolve_exception(uuid,text)', 'ack_incident(uuid)',
    'resolve_incident(uuid,text)', 'broadcast_trip(uuid,text)', 'send_optin(uuid[])', 'import_students(jsonb)',
    'live_board()', 'where_is_student(uuid)', 'student_journey(uuid,date,date)', 'report_daily_attendance(date)',
    'report_trip_performance(date,date)', 'report_exceptions_summary(date,date)', 'report_scan_compliance(date,date)',
    'report_notifications(date,date)', 'report_safety(date,date)', 'my_org()', 'my_role()', 'can_write()', 'is_admin()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
