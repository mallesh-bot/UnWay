-- =====================================================================
-- Row Level Security: every tenant table is scoped to the caller's org.
-- Devices and parents never use table access directly; they call
-- SECURITY DEFINER RPCs that verify their token.
-- =====================================================================

create or replace function public.my_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.org_users where user_id = auth.uid()
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.org_users where user_id = auth.uid()
$$;

create or replace function public.can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('school_admin','transport_manager') from public.org_users where user_id = auth.uid()), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'school_admin' from public.org_users where user_id = auth.uid()), false)
$$;

-- Generic tenant policies
do $$
declare t text;
begin
  foreach t in array array[
    'campuses','calendar_days','students','credential_history','guardians','student_guardians',
    'guardian_channels','consents','absences','buses','crew_members','bus_crew','devices',
    'bus_live_state','stops','routes','route_stops','transport_assignments','trips',
    'trip_manifest','scan_events','location_points','exceptions','incidents',
    'notification_outbox','inbound_messages','audit_log','tracking_tokens'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Read access: same org
do $$
declare t text;
begin
  foreach t in array array[
    'campuses','calendar_days','students','credential_history','student_guardians',
    'consents','absences','buses','crew_members','bus_crew','devices',
    'bus_live_state','stops','routes','route_stops','transport_assignments','trips',
    'trip_manifest','scan_events','location_points','exceptions','incidents',
    'notification_outbox','inbound_messages','audit_log'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (org_id = public.my_org())', t || '_read', t);
  end loop;
end $$;

-- Write access: admins & transport managers, same org (direct table writes)
do $$
declare t text;
begin
  foreach t in array array[
    'campuses','calendar_days','students','guardians','student_guardians','guardian_channels',
    'absences','buses','crew_members','bus_crew','stops','routes','route_stops',
    'transport_assignments','trips','exceptions','incidents','consents'
  ] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (org_id = public.my_org() and public.can_write())', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (org_id = public.my_org() and public.can_write()) with check (org_id = public.my_org())', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (org_id = public.my_org() and public.can_write())', t || '_del', t);
  end loop;
end $$;

-- Organizations: members can read their org; only school_admin updates.
alter table public.organizations enable row level security;
grant select, update on public.organizations to authenticated;
create policy organizations_read on public.organizations for select to authenticated using (id = public.my_org());
create policy organizations_upd on public.organizations for update to authenticated using (id = public.my_org() and public.is_admin()) with check (id = public.my_org());

-- Org users: members can see colleagues; admins manage.
alter table public.org_users enable row level security;
grant select, update, delete on public.org_users to authenticated;
create policy org_users_read on public.org_users for select to authenticated using (org_id = public.my_org() or user_id = auth.uid());
create policy org_users_upd on public.org_users for update to authenticated using (org_id = public.my_org() and public.is_admin()) with check (org_id = public.my_org());
create policy org_users_del on public.org_users for delete to authenticated using (org_id = public.my_org() and public.is_admin() and user_id <> auth.uid());

-- Internal tables: RLS on, no policies, no grants => invisible to API roles.
alter table public.org_secrets enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.device_events enable row level security;
alter table public.trip_stop_visits enable row level security;
revoke all on public.org_secrets, public.pairing_codes, public.device_events from anon, authenticated;
grant select on public.trip_stop_visits to authenticated;
create policy trip_stop_visits_read on public.trip_stop_visits for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.org_id = public.my_org()));

-- Devices: never expose token hashes to the dashboard.
revoke select on public.devices from authenticated;
grant select (id, org_id, bus_id, model, os_version, app_version, paired_at, last_seen_at, battery, gps_enabled, pending_queue, revoked_at)
  on public.devices to authenticated;

-- Crew PIN hashes are write-only from the dashboard's point of view.
revoke select on public.crew_members from authenticated;
grant select (id, org_id, name, role, phone, licence_no, licence_valid_until, medical_check_date, active, created_at)
  on public.crew_members to authenticated;

-- Viewers should not see raw guardian phone numbers: expose a masked view.
create policy guardians_read on public.guardians for select to authenticated using (org_id = public.my_org() and public.can_write());
create policy guardian_channels_read on public.guardian_channels for select to authenticated using (org_id = public.my_org() and public.can_write());

-- Owner-privileged view (bypasses RLS) but filtered to the caller's org.
create or replace view public.guardians_masked as
  select g.id, g.org_id, g.name, g.relation,
         case when public.can_write() then g.phone
              else regexp_replace(coalesce(g.phone,''), '(\+?\d{4})\d+(\d{2})', '\1xxxx\2') end as phone,
         case when public.can_write() then g.email else null end as email,
         g.language, g.created_at
  from public.guardians g
  where g.org_id = public.my_org();
grant select on public.guardians_masked to authenticated;

-- Realtime (Supabase only): publish tables used by the live board.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bus_live_state, public.exceptions, public.incidents, public.trips, public.trip_manifest;
  end if;
end $$;
