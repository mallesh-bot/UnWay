-- =====================================================================
-- Scheduled jobs: rule sweeps, trip generation, retention, dispatch kick.
-- pg_cron / pg_net / vault are Supabase extensions; scheduling is skipped
-- automatically where they are not installed (e.g. local tests).
-- =====================================================================

create or replace function public.cron_minutely() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_n_late int := 0; v_n_off int := 0; v_n_closed int := 0; v_local timestamp;
begin
  -- Late starts
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

  -- Device offline during an active trip
  for r in select t.*, b.display_number from public.trips t
             left join public.buses b on b.id = t.bus_id
             left join public.bus_live_state l on l.bus_id = t.bus_id
            where t.status = 'active'
              and coalesce(l.updated_at, t.started_at) < now() - make_interval(mins => coalesce((public.org_setting(t.org_id,'device_offline_min'))::int, 3)) loop
    perform public._raise_exception(r.org_id, r.id, null, r.bus_id, 'DEVICE_OFFLINE', 'high',
       'No location from Bus ' || coalesce(r.display_number,'?') || ' for several minutes', '{}'::jsonb);
    v_n_off := v_n_off + 1;
  end loop;

  -- Auto-close forgotten trips after 23:00 local or from previous days
  for r in select t.* from public.trips t join public.organizations o on o.id = t.org_id
            where t.status = 'active'
              and (t.trip_date < (now() at time zone o.timezone)::date
                   or (now() at time zone o.timezone)::time > time '23:00') loop
    update public.trip_manifest set state = 'UNCONFIRMED', state_at = now(), resolved_reason = 'trip auto-closed'
     where trip_id = r.id and state = 'ON_BOARD';
    update public.trip_manifest set state = 'NO_SHOW', state_at = now(), resolved_reason = 'trip auto-closed'
     where trip_id = r.id and state = 'EXPECTED';
    update public.trips set status = 'aborted_auto', completed_at = now(), completion_reason = 'Not completed by crew' where id = r.id;
    if r.empty_bus_check is null or exists (select 1 from public.trip_manifest where trip_id = r.id and state = 'UNCONFIRMED') then
      perform public._raise_exception(r.org_id, r.id, null, r.bus_id, 'CHILD_LEFT_ON_BUS_RISK', 'critical',
         'Trip was never completed and the Empty Bus Check is missing. Check the bus now.', '{}'::jsonb);
    end if;
    v_n_closed := v_n_closed + 1;
  end loop;

  return jsonb_build_object('late', v_n_late, 'offline', v_n_off, 'auto_closed', v_n_closed);
end $$;

create or replace function public.cron_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_trips int := 0;
begin
  for r in select id from public.organizations loop
    v_trips := v_trips + public.generate_trips_for_org(r.id, public._org_today(r.id));
    v_trips := v_trips + public.generate_trips_for_org(r.id, public._org_today(r.id) + 1);
  end loop;
  -- retention (keeps the free 500 MB database healthy)
  delete from public.location_points where ts < now() - interval '90 days';
  delete from public.device_events where created_at < now() - interval '30 days';
  delete from public.notification_outbox where created_at < now() - interval '60 days';
  delete from public.tracking_tokens where valid_date < current_date - 7;
  delete from public.pairing_codes where expires_at < now() - interval '1 day';
  delete from public.inbound_messages where created_at < now() - interval '90 days';
  return jsonb_build_object('trips_generated', v_trips);
end $$;

-- Calls the dispatch Edge Function if there is queued work.
-- Needs vault secrets 'unway_functions_url' (https://<ref>.supabase.co/functions/v1)
-- and 'unway_dispatch_secret' (same value as DISPATCH_SECRET in function env).
create or replace function public.kick_dispatch() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net')
     or to_regclass('vault.decrypted_secrets') is null then return; end if;
  if not exists (select 1 from public.notification_outbox where status = 'queued' and next_attempt_at <= now() + interval '5 seconds') then
    return;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'unway_functions_url'$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'unway_dispatch_secret'$q$ into v_secret;
  if v_url is null or v_secret is null then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using v_url || '/dispatch', '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-unway-secret', v_secret);
end $$;

-- Statement-level trigger: one kick per insert statement into the outbox
create or replace function public._outbox_kick_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.kick_dispatch();
  exception when others then
    null; -- never block the scan transaction because of a dispatch problem
  end;
  return null;
end $$;

create trigger notification_outbox_kick after insert on public.notification_outbox
  for each statement execute function public._outbox_kick_trigger();

revoke all on function public.cron_minutely(), public.cron_daily(), public.kick_dispatch(), public._outbox_kick_trigger()
  from public, anon, authenticated;

-- Schedule with pg_cron when available (Supabase). Times are UTC.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job where jobname like 'unway-%';
    perform cron.schedule('unway-minutely', '* * * * *', 'select public.cron_minutely()');
    perform cron.schedule('unway-dispatch-retry', '30 seconds', 'select public.kick_dispatch()');
    perform cron.schedule('unway-daily', '35 18 * * *', 'select public.cron_daily()');  -- 00:05 IST
  end if;
end $$;
