-- v2 features: parent dashboard, platform console, auto route plan, approaching alerts, WhatsApp JOIN
\set ON_ERROR_STOP 1
\set QUIET 1
create or replace function pg_temp.ok(c boolean, msg text) returns text language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FAIL: %', msg; end if; return 'ok ' || msg; end $$;

insert into auth.users(id, email) values ('44444444-4444-4444-4444-444444444444', 'v2@school.test'),
                                         ('55555555-5555-5555-5555-555555555555', 'palukurimallesh@gmail.com');
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","email":"v2@school.test"}';
select public.create_organization('V2 School', 'VTS', 'Main', 17.45, 78.39) as org \gset
select public.create_demo_data() is not null as demo \gset
select pg_temp.ok((public.my_membership()->>'role') = 'school_admin', 'membership role');
select pg_temp.ok(not public.is_platform_admin(), 'school admin is not platform');
select pg_temp.ok((public.setup_status()->>'students')::int = 16, 'setup_status students');
select pg_temp.ok((select count(*) from public.school_trends(7)) = 7, 'trends 7 days');
do $$ begin perform public.platform_overview(); raise exception 'should fail'; exception when insufficient_privilege then null; end $$;

-- parent dashboard -------------------------------------------------------
reset role; reset request.jwt.claims;
select g.portal_token as ptok, s.id as kid, g.id as gid, g.invite_code as icode
  from public.guardians g join public.student_guardians sg on sg.guardian_id = g.id join public.students s on s.id = sg.student_id
 where g.org_id = :'org' order by s.first_name limit 1 \gset
select id as other_kid from public.students where org_id = :'org' and id <> :'kid' limit 1 \gset
set role anon;
select public.parent_portal(:'ptok') as portal \gset
select pg_temp.ok(jsonb_array_length(:'portal'::jsonb->'children') = 1, 'portal children');
select pg_temp.ok((:'portal'::jsonb->'school'->>'name') = 'V2 School', 'portal school');
select pg_temp.ok(jsonb_array_length(:'portal'::jsonb->'children'->0->'routes') >= 1, 'portal routes');
select (public.parent_set_absence(:'ptok', :'kid', (now() at time zone 'Asia/Kolkata')::date + 1, 'BOTH')->>'id') as absid \gset
select pg_temp.ok(jsonb_array_length(public.parent_portal(:'ptok')->'children'->0->'absences') = 1, 'absence listed');
select public.parent_cancel_absence(:'ptok', :'absid');
select pg_temp.ok(jsonb_array_length(public.parent_portal(:'ptok')->'children'->0->'absences') = 0, 'absence cancelled');
do $$ begin perform public.parent_portal('nope-nope-nope-nope-nope'); raise exception 'should fail';
  exception when others then if sqlerrm <> 'INVALID_LINK' then raise; end if; end $$;
select set_config('t.ptok', :'ptok', false), set_config('t.other', :'other_kid', false);
do $$ begin perform public.parent_history(current_setting('t.ptok'), current_setting('t.other')::uuid); raise exception 'should fail';
  exception when others then if sqlerrm <> 'NOT_YOUR_CHILD' then raise; end if; end $$;
select pg_temp.ok(jsonb_typeof(public.parent_history(:'ptok', :'kid')) = 'array', 'history');
select public.parent_set_preferences(:'ptok', 'te');
select pg_temp.ok((public.parent_portal(:'ptok')->'guardian'->>'language') = 'te', 'language pref');
select pg_temp.ok((public.join_info(:'icode')->>'portal_token') = :'ptok', 'join_info portal token');

-- WhatsApp JOIN + LINK -------------------------------------------------------
reset role;
select pg_temp.ok((public.svc_guardian_command('whatsapp', '+91 98888 77777', 'JOIN ' || :'icode')->>'ok')::boolean, 'whatsapp join');
select public.svc_guardian_command('whatsapp', '919888877777', 'link') as linkres \gset
select pg_temp.ok((:'linkres'::jsonb->'items'->0->>'type') = 'portal', 'link returns portal');
-- unknown number that matches a guardian phone is auto-linked
select phone as ph2 from public.guardians where org_id = :'org' and id <> :'gid' and phone is not null limit 1 \gset
select pg_temp.ok((public.svc_guardian_command('whatsapp', regexp_replace(:'ph2', '\D', '', 'g'), 'hi')->>'ok')::boolean, 'auto-link by phone');

-- approaching alerts -------------------------------------------------------
insert into public.guardian_channels(org_id, guardian_id, channel, address, status)
select :'org', sg.guardian_id, 'telegram', 'tg-' || sg.guardian_id, 'active'
  from public.student_guardians sg where sg.org_id = :'org' on conflict do nothing;
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","email":"v2@school.test"}';
select (public.create_pairing_code(id)->>'code') as pcode from public.buses where org_id = :'org' and display_number = 'D1' \gset
reset role; reset request.jwt.claims; set role anon;
select (public.dev_pair(:'pcode', '{}')->>'device_token') as dtok \gset
select public.dev_bootstrap(:'dtok') as boot \gset
select (select value->>'id' from jsonb_array_elements(:'boot'::jsonb->'trips') where value->>'direction' = 'MORNING' limit 1) as amtrip,
       (select value->>'id' from jsonb_array_elements(:'boot'::jsonb->'crew') where value->>'role' = 'driver' limit 1) as drv,
       (select value->>'id' from jsonb_array_elements(:'boot'::jsonb->'crew') where value->>'role' = 'attendant' limit 1) as att \gset
select public.dev_start_trip(:'dtok', :'amtrip', :'drv', :'att') as td \gset
select (:'td'::jsonb->'stops'->0->>'lat')::float8 as slat, (:'td'::jsonb->'stops'->0->>'lng')::float8 as slng \gset
-- ~700 m north of the first stop
select public.dev_locations(:'dtok', :'amtrip', jsonb_build_array(jsonb_build_object('ts', now(), 'lat', :slat + 0.0063, 'lng', :slng, 'acc', 10, 'speed', 6)), 80);
reset role;
select count(*) as napp from public.notification_outbox where org_id = :'org' and event_type = 'APPROACHING' \gset
select pg_temp.ok(:napp > 0, 'approaching alerts queued: ' || :napp);
-- second ping does not duplicate
set role anon;
select public.dev_locations(:'dtok', :'amtrip', jsonb_build_array(jsonb_build_object('ts', now(), 'lat', :slat + 0.005, 'lng', :slng, 'acc', 10, 'speed', 6)), 80);
reset role;
select pg_temp.ok((select count(*) from public.notification_outbox where org_id = :'org' and event_type = 'APPROACHING') = :napp, 'no duplicate approaching');
select pg_temp.ok((select bool_and(payload ? 'portal_token') from public.notification_outbox where org_id = :'org' and event_type = 'APPROACHING'), 'payload has portal token');

-- escalation + evening summary run cleanly
update public.exceptions set opened_at = now() - interval '10 minutes' where org_id = :'org';
select public._escalate() as esc \gset
select public.cron_evening() as eve \gset
select public.cron_daily() as daily \gset
\echo escalated :esc evening :eve daily :daily

-- auto route plan ------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","email":"v2@school.test"}';
select id as bus2 from public.buses where display_number = 'D2' \gset
select array_agg(id order by first_name) as kids from (select id, first_name from public.students order by first_name limit 3) x \gset
select public.apply_route_plan(jsonb_build_object(
  'stops', jsonb_build_array(jsonb_build_object('key','a','name','Auto A','lat',17.40,'lng',78.38),
                             jsonb_build_object('key','b','name','Auto B','lat',17.42,'lng',78.385)),
  'routes', jsonb_build_array(jsonb_build_object('bus_id', :'bus2', 'code', 'A1', 'name', 'Auto 1', 'am_start', '07:05', 'pm_start', '15:05',
     'stops', jsonb_build_array(jsonb_build_object('key','a','offset_min',0), jsonb_build_object('key','b','offset_min',9)),
     'students', (select jsonb_agg(jsonb_build_object('student_id', k, 'stop_key', case when i = 1 then 'a' else 'b' end))
                    from unnest(:'kids'::uuid[]) with ordinality u(k, i))))), false) as plan \gset
select pg_temp.ok((:'plan'::jsonb->>'routes')::int = 1 and (:'plan'::jsonb->>'students')::int = 3, 'route plan applied');
select pg_temp.ok((select planned_offset_min from public.route_stops rs join public.routes r on r.id = rs.route_id
                   join public.stops s on s.id = rs.stop_id where r.code = 'A1-PM' and s.name = 'Auto A') = 14, 'pm offsets reversed');
select pg_temp.ok((select count(*) from public.transport_assignments where effective_to is null and route_id in (select id from public.routes where code like 'A1%')) = 6, 'assignments');

-- platform console ------------------------------------------------------------
set request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","email":"palukurimallesh@gmail.com"}';
select pg_temp.ok(public.is_platform_admin(), 'platform admin');
select pg_temp.ok((public.platform_overview()->>'schools')::int >= 1, 'overview');
select pg_temp.ok(jsonb_array_length(public.platform_schools()) >= 1, 'schools list');
select pg_temp.ok(public.my_org() is null, 'no org before view');
select public.platform_view_school(:'org');
select pg_temp.ok(public.my_org() = :'org'::uuid and public.my_role() = 'viewer', 'view as school');
select pg_temp.ok((public.my_membership()->>'viewing_as_platform')::boolean, 'membership viewing flag');
select pg_temp.ok((select count(*) from public.students) = 16, 'platform can read school rows');
do $$ begin perform public.invite_all_whatsapp(); raise exception 'should fail';
  exception when others then if sqlerrm = 'should fail' then raise; end if; end $$;
select public.platform_view_school(null);
select pg_temp.ok(public.my_org() is null, 'left school view');
select public.platform_create_school('Pilot School', 'PLT', 17.4, 78.4, '+914000000000', 'Mr Rao', '+919000000009', 'Rao@x.test') as newschool \gset
select public.platform_update_school(:'newschool', 'active', 'pilot', 'first pilot');
select pg_temp.ok((public.platform_overview()->>'schools_active')::int = 1, 'school activated');
select pg_temp.ok(jsonb_typeof(public.platform_messages('all', 10)) = 'array', 'messages');
select pg_temp.ok(public.platform_retry_failed() >= 0, 'retry');
select pg_temp.ok(public.platform_health() ? 'jobs', 'health');
select public.platform_set_admin('cofounder@x.test', true);
select pg_temp.ok(jsonb_array_length(public.platform_health()->'platform_admins') = 2, 'admin added');
-- suspended school: bus phone refused
select public.platform_update_school(:'org', 'suspended');
reset role; reset request.jwt.claims; set role anon;
select set_config('t.dtok', :'dtok', false);
do $$ begin perform public.dev_bootstrap(current_setting('t.dtok')); raise exception 'should fail';
  exception when others then if sqlerrm <> 'ORG_SUSPENDED' then raise; end if; end $$;
reset role;
\echo V2 TESTS PASSED
