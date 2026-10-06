-- =====================================================================
-- Parent-facing API (tracking page, push subscribe, join page) and
-- service-only messaging API (used by Edge Functions with service role).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Public: tracking snapshot by daily token (anon)
-- ---------------------------------------------------------------------
create or replace function public.track_snapshot(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tok public.tracking_tokens%rowtype; v_stu public.students%rowtype; v_org public.organizations%rowtype;
  v_trip public.trips%rowtype; v_m public.trip_manifest%rowtype; v_live public.bus_live_state%rowtype;
  v_bus text; v_events jsonb; v_stops jsonb; v_campus jsonb; v_eta jsonb; v_target uuid; v_target_name text;
  v_speed double precision; v_remaining double precision; v_prev_lat double precision; v_prev_lng double precision;
  v_hops int := 0; s record; v_passed boolean;
begin
  select * into v_tok from public.tracking_tokens where token = p_token;
  if not found or v_tok.valid_date < (now() at time zone 'Asia/Kolkata')::date - 1 then
    return jsonb_build_object('ok', false, 'code', 'LINK_EXPIRED');
  end if;
  select * into v_stu from public.students where id = v_tok.student_id;
  select * into v_org from public.organizations where id = v_tok.org_id;

  select jsonb_build_object('name', c.name, 'lat', c.lat, 'lng', c.lng, 'desk_phone', c.desk_phone)
    into v_campus from public.campuses c where c.org_id = v_org.id order by (c.id = v_stu.campus_id) desc, c.created_at limit 1;

  -- today's events for this child
  select coalesce(jsonb_agg(jsonb_build_object(
           'direction', t.direction, 'state', m.state, 'board_at', m.board_at, 'drop_at', m.drop_at,
           'bus', b.display_number, 'trip_status', t.status) order by t.scheduled_start), '[]'::jsonb)
    into v_events
    from public.trip_manifest m join public.trips t on t.id = m.trip_id left join public.buses b on b.id = t.bus_id
   where m.student_id = v_stu.id and t.trip_date = v_tok.valid_date and m.state <> 'TRANSFERRED';

  -- the most relevant trip: active first, else latest
  select t.* into v_trip from public.trip_manifest m join public.trips t on t.id = m.trip_id
   where m.student_id = v_stu.id and t.trip_date = v_tok.valid_date and m.state <> 'TRANSFERRED'
   order by (t.status = 'active') desc, t.scheduled_start desc limit 1;

  if v_trip.id is not null then
    select * into v_m from public.trip_manifest where trip_id = v_trip.id and student_id = v_stu.id;
    select display_number into v_bus from public.buses where id = v_trip.bus_id;
    if v_trip.status = 'active' then
      select * into v_live from public.bus_live_state where bus_id = v_trip.bus_id;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'lat', st.lat, 'lng', st.lng, 'seq', rs.seq,
                                                 'mine', st.id = v_m.stop_id) order by rs.seq), '[]'::jsonb)
      into v_stops from public.route_stops rs join public.stops st on st.id = rs.stop_id where rs.route_id = v_trip.route_id;

    -- ETA: to child's stop (morning, not boarded yet / afternoon on board) or to school (morning on board)
    if v_trip.status = 'active' and v_live.lat is not null then
      if v_trip.direction = 'MORNING' and v_m.state = 'EXPECTED' then v_target := v_m.stop_id;
      elsif v_trip.direction = 'AFTERNOON' and v_m.state in ('ON_BOARD','EXPECTED') then v_target := v_m.stop_id;
      end if;
      select coalesce(avg(lp.speed_kmh) filter (where lp.speed_kmh > 3), 0) into v_speed
        from public.location_points lp where lp.trip_id = v_trip.id and lp.ts > now() - interval '10 minutes';
      v_speed := greatest(12, least(35, coalesce(nullif(v_speed, 0), 20)));
      v_prev_lat := v_live.lat; v_prev_lng := v_live.lng; v_remaining := 0;
      if v_target is not null then
        for s in select st.id, st.name, st.lat, st.lng, rs.seq from public.route_stops rs join public.stops st on st.id = rs.stop_id
                  where rs.route_id = v_trip.route_id order by rs.seq loop
          select exists(select 1 from public.trip_stop_visits v where v.trip_id = v_trip.id and v.stop_id = s.id) into v_passed;
          continue when v_passed and s.id <> v_target;
          v_remaining := v_remaining + public.geo_dist_m(v_prev_lat, v_prev_lng, s.lat, s.lng) * 1.3;  -- road factor
          v_prev_lat := s.lat; v_prev_lng := s.lng;
          if s.id = v_target then v_target_name := s.name; exit; end if;
          v_hops := v_hops + 1;
        end loop;
      elsif v_trip.direction = 'MORNING' and v_m.state = 'ON_BOARD' then
        v_remaining := public.geo_dist_m(v_live.lat, v_live.lng, (v_campus->>'lat')::double precision, (v_campus->>'lng')::double precision) * 1.3;
        v_target_name := v_campus->>'name';
      end if;
      if v_target_name is not null then
        v_eta := jsonb_build_object('to', v_target_name,
                   'minutes', greatest(1, round((v_remaining / 1000.0) / v_speed * 60 + v_hops * 0.5)));
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'date', v_tok.valid_date, 'child', v_stu.first_name, 'school', v_org.name, 'campus', v_campus,
    'events', v_events,
    'trip', case when v_trip.id is null then null else jsonb_build_object(
              'direction', v_trip.direction, 'status', v_trip.status, 'bus', v_bus, 'state', v_m.state,
              'started_at', v_trip.started_at, 'completed_at', v_trip.completed_at) end,
    'live', case when v_live.bus_id is null then null else jsonb_build_object(
              'lat', v_live.lat, 'lng', v_live.lng, 'heading', v_live.heading, 'speed_kmh', v_live.speed_kmh,
              'updated_at', v_live.updated_at) end,
    'stops', coalesce(v_stops, '[]'::jsonb), 'eta', v_eta, 'server_ts', now());
end $$;

-- ---------------------------------------------------------------------
-- Public: parent "join" page (from printed invite slip / QR)
-- ---------------------------------------------------------------------
create or replace function public.join_info(p_invite_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when g.id is null then jsonb_build_object('ok', false) else jsonb_build_object(
    'ok', true, 'guardian', split_part(g.name, ' ', 1), 'school', o.name, 'language', g.language,
    'children', (select coalesce(jsonb_agg(s.first_name), '[]'::jsonb) from public.student_guardians sg
                   join public.students s on s.id = sg.student_id where sg.guardian_id = g.id),
    'channels', (select coalesce(jsonb_agg(distinct gc.channel), '[]'::jsonb) from public.guardian_channels gc
                   where gc.guardian_id = g.id and gc.status = 'active')) end
  from (select 1) x
  left join public.guardians g on g.invite_code = upper(p_invite_code)
  left join public.organizations o on o.id = g.org_id
$$;

create or replace function public.webpush_subscribe(p_invite_code text, p_subscription jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.guardians%rowtype; v_endpoint text := p_subscription->>'endpoint';
begin
  select * into g from public.guardians where invite_code = upper(p_invite_code);
  if not found then return jsonb_build_object('ok', false, 'code', 'INVALID_CODE'); end if;
  if v_endpoint is null or v_endpoint !~ '^https://' then return jsonb_build_object('ok', false, 'code', 'INVALID_SUBSCRIPTION'); end if;
  delete from public.guardian_channels where guardian_id = g.id and channel = 'webpush' and address::jsonb->>'endpoint' = v_endpoint;
  insert into public.guardian_channels(org_id, guardian_id, channel, address, status, verified_at)
  values (g.org_id, g.id, 'webpush', p_subscription::text, 'active', now());
  insert into public.consents(org_id, guardian_id, channel) values (g.org_id, g.id, 'webpush');
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.track_snapshot(text), public.join_info(text), public.webpush_subscribe(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Service-only: channel linking & inbound commands
-- ---------------------------------------------------------------------
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
  return jsonb_build_object('ok', true, 'guardian', g.name, 'school', v_school, 'children', coalesce(v_children, ''), 'language', g.language);
end $$;

create or replace function public.svc_link_staff_telegram(p_join_code text, p_chat_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.organizations%rowtype; v_ids jsonb;
begin
  select * into o from public.organizations where staff_join_code = upper(trim(p_join_code));
  if not found then return jsonb_build_object('ok', false); end if;
  v_ids := coalesce(o.settings->'staff_telegram_chat_ids', '[]'::jsonb);
  if not v_ids ? p_chat_id then v_ids := v_ids || to_jsonb(p_chat_id); end if;
  update public.organizations set settings = settings || jsonb_build_object('staff_telegram_chat_ids', v_ids) where id = o.id;
  return jsonb_build_object('ok', true, 'school', o.name);
end $$;

-- Parent command over Telegram/WhatsApp. p_address = telegram chat id or whatsapp phone digits.
-- Returns structured data; the Edge Function renders the reply text.
create or replace function public.svc_guardian_command(p_channel text, p_address text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cmd text; v_arg text; v_words text[]; g record; v_out jsonb := '[]'::jsonb; v_date date; v_legs text;
  v_found boolean := false; v_lang text := 'en'; s record; v_status jsonb; v_desk text; v_today date;
begin
  v_words := regexp_split_to_array(upper(trim(coalesce(p_text, ''))), '\s+');
  v_cmd := replace(v_words[1], '/', '');
  v_arg := array_to_string(v_words[2:], ' ');

  for g in
    select gd.*, gc.id as channel_id from public.guardian_channels gc join public.guardians gd on gd.id = gc.guardian_id
     where gc.channel = p_channel
       and (gc.address = p_address or (p_channel = 'whatsapp' and regexp_replace(gc.address, '\D', '', 'g') = regexp_replace(p_address, '\D', '', 'g')))
  loop
    v_found := true; v_lang := g.language;
    update public.guardian_channels set last_inbound_at = now() where id = g.channel_id;
    insert into public.inbound_messages(org_id, channel, from_address, guardian_id, body, command)
    values (g.org_id, p_channel, p_address, g.id, left(p_text, 500), v_cmd);
    v_today := public._org_today(g.org_id);
    select desk_phone into v_desk from public.campuses where org_id = g.org_id order by created_at limit 1;

    if v_cmd in ('STOP','UNSUBSCRIBE') then
      update public.guardian_channels set status = 'stopped' where id = g.channel_id;
      update public.consents set withdrawn_at = now() where guardian_id = g.id and channel = p_channel and withdrawn_at is null;
      v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'stopped'));
    elsif v_cmd in ('START','YES','JOIN') then
      update public.guardian_channels set status = 'active', verified_at = coalesce(verified_at, now()) where id = g.channel_id;
      insert into public.consents(org_id, guardian_id, channel) values (g.org_id, g.id, p_channel);
      v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'started'));
    elsif v_cmd = 'ABSENT' then
      v_date := case when v_arg like '%TODAY%' then v_today else v_today + 1 end;
      v_legs := case when v_arg like '%AM%' or v_arg like '%MORNING%' then 'AM'
                     when v_arg like '%PM%' or v_arg like '%EVENING%' or v_arg like '%AFTERNOON%' then 'PM' else 'BOTH' end;
      for s in select st.id, st.first_name from public.student_guardians sg join public.students st on st.id = sg.student_id
                where sg.guardian_id = g.id and st.transport_status = 'active' loop
        insert into public.absences(org_id, student_id, date, legs, source)
        values (g.org_id, s.id, v_date, v_legs, 'parent_' || p_channel);
        -- if today's trip is already running and the child is still expected, update the manifest
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

-- ---------------------------------------------------------------------
-- Service-only: outbox processing
-- ---------------------------------------------------------------------
create or replace function public.svc_outbox_claim(p_limit int default 50) returns setof public.notification_outbox
language plpgsql security definer set search_path = public as $$
begin
  -- recover rows stuck in "sending" (crashed worker)
  update public.notification_outbox set status = 'queued'
   where status = 'sending' and next_attempt_at < now() - interval '2 minutes';
  return query
    update public.notification_outbox o set status = 'sending', attempts = o.attempts + 1, next_attempt_at = now()
     where o.id in (select id from public.notification_outbox
                     where status = 'queued' and next_attempt_at <= now()
                     order by created_at limit p_limit for update skip locked)
    returning o.*;
end $$;

create or replace function public.svc_outbox_result(p_id uuid, p_ok boolean, p_provider_id text default null,
                                                    p_error text default null, p_permanent boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_attempts int;
begin
  select attempts into v_attempts from public.notification_outbox where id = p_id;
  if p_ok then
    update public.notification_outbox set status = 'sent', sent_at = now(), provider_message_id = p_provider_id, error = null where id = p_id;
  elsif p_permanent or v_attempts >= 5 then
    update public.notification_outbox set status = 'failed', error = left(p_error, 500) where id = p_id;
  else
    update public.notification_outbox set status = 'queued', error = left(p_error, 500),
           next_attempt_at = now() + make_interval(secs => 15 * power(2, v_attempts)::int) where id = p_id;
  end if;
end $$;

-- Delivery receipts (WhatsApp status webhooks)
create or replace function public.svc_outbox_status(p_provider_id text, p_status text, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.notification_outbox
     set status = case when p_status in ('delivered','read','failed','sent') then p_status else status end,
         delivered_at = case when p_status in ('delivered','read') then coalesce(delivered_at, now()) else delivered_at end,
         error = coalesce(p_error, error)
   where provider_message_id = p_provider_id
$$;

-- Mark a channel broken (e.g. Telegram user blocked bot, push subscription gone)
create or replace function public.svc_channel_failed(p_channel text, p_address text) returns void
language sql security definer set search_path = public as $$
  update public.guardian_channels set status = 'failed' where channel = p_channel and address = p_address
$$;

do $$
declare f text;
begin
  foreach f in array array['svc_link_telegram(text,text,text)', 'svc_link_staff_telegram(text,text)',
    'svc_guardian_command(text,text,text)', 'svc_outbox_claim(int)', 'svc_outbox_result(uuid,boolean,text,text,boolean)',
    'svc_outbox_status(text,text,text)', 'svc_channel_failed(text,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
