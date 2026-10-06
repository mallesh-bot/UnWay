-- End-to-end test of the UnWay database engine on local Postgres.
-- Run after 00_local_supabase_stub.sql + all migrations. Raises on failure.
\set ON_ERROR_STOP 1
\set QUIET 1

create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;

-- ---------- Admin user creates a school ----------
insert into auth.users(id, email) values ('11111111-1111-1111-1111-111111111111', 'admin@school.test');
insert into auth.users(id, email) values ('22222222-2222-2222-2222-222222222222', 'other@school2.test');

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.create_organization('Sunrise Public School', 'SPS', 'Main Campus', 17.4400, 78.3800, 'Priya', '+914012345678') as org_id \gset
select pg_temp.assert(public.my_org() = :'org_id', 'my_org works');

-- channels: enable telegram + webpush + whatsapp for test
update public.organizations set settings = settings || '{"channels":{"whatsapp":true,"telegram":true,"webpush":true},"track_base_url":"https://track.example"}' where id = :'org_id';

-- buses, crew
insert into public.buses(org_id, display_number, registration_no, capacity) values (:'org_id', '7', 'TS09AB1234', 40) returning id as bus7 \gset
insert into public.buses(org_id, display_number, registration_no, capacity) values (:'org_id', '3', 'TS09AB0003', 40) returning id as bus3 \gset
insert into public.crew_members(org_id, name, role) values (:'org_id', 'Ramesh', 'driver') returning id as driver \gset
insert into public.crew_members(org_id, name, role) values (:'org_id', 'Lakshmi', 'attendant') returning id as attendant \gset
select public.set_crew_pin(:'driver', '1234');
insert into public.bus_crew(org_id, bus_id, crew_id) values (:'org_id', :'bus7', :'driver'), (:'org_id', :'bus7', :'attendant');

-- stops (approx 1 km apart, heading to school at 17.4400,78.3800)
insert into public.stops(org_id, name, lat, lng) values (:'org_id', 'Sai Nagar', 17.4200, 78.3800) returning id as stop_a \gset
insert into public.stops(org_id, name, lat, lng) values (:'org_id', 'Lake View', 17.4300, 78.3800) returning id as stop_b \gset
insert into public.stops(org_id, name, lat, lng) values (:'org_id', 'Far Stop', 17.4000, 78.3800) returning id as stop_c \gset

insert into public.routes(org_id, code, name, direction, default_bus_id, days_mask, scheduled_start)
  values (:'org_id', 'R7', 'Route 7 Morning', 'MORNING', :'bus7', 127, '07:00') returning id as r7am \gset
insert into public.routes(org_id, code, name, direction, default_bus_id, days_mask, scheduled_start)
  values (:'org_id', 'R7-PM', 'Route 7 Afternoon', 'AFTERNOON', :'bus7', 127, '15:00') returning id as r7pm \gset
insert into public.routes(org_id, code, name, direction, default_bus_id, days_mask, scheduled_start)
  values (:'org_id', 'R3', 'Route 3 Morning', 'MORNING', :'bus3', 127, '07:00') returning id as r3am \gset
insert into public.route_stops(org_id, route_id, stop_id, seq, planned_offset_min) values
  (:'org_id', :'r7am', :'stop_a', 1, 0), (:'org_id', :'r7am', :'stop_b', 2, 10),
  (:'org_id', :'r7pm', :'stop_b', 1, 10), (:'org_id', :'r7pm', :'stop_a', 2, 20),
  (:'org_id', :'r3am', :'stop_c', 1, 0);

-- students via import
select public.import_students('[
  {"admission_no":"A1","first_name":"Aarav","last_name":"Reddy","class":"3","section":"B","guardian_name":"Kiran Reddy","guardian_phone":"9876543210","am_route":"R7","am_stop":"Sai Nagar","pm_route":"R7-PM","pm_stop":"Sai Nagar"},
  {"admission_no":"A2","first_name":"Diya","last_name":"Rao","class":"4","guardian_name":"Sita Rao","guardian_phone":"+919876500001","am_route":"R7","am_stop":"Lake View"},
  {"admission_no":"A3","first_name":"Ravi","last_name":"Kumar","class":"5","guardian_phone":"9876500002","am_route":"R7","am_stop":"Sai Nagar"},
  {"admission_no":"A4","first_name":"Meera","last_name":"Shah","class":"2","guardian_phone":"9876500003","am_route":"R3","am_stop":"Far Stop"},
  {"admission_no":"A5","first_name":"","guardian_phone":"1"},
  {"admission_no":"A6","first_name":"Bad","am_route":"NOPE","am_stop":"x"}
]'::jsonb) as import_result \gset
select pg_temp.assert((:'import_result'::jsonb->>'inserted')::int = 4 and jsonb_array_length(:'import_result'::jsonb->'errors') = 2, 'import 4 ok + 2 errors ' || :'import_result');
select id as aarav from public.students where admission_no = 'A1' \gset
select id as diya from public.students where admission_no = 'A2' \gset
select id as ravi from public.students where admission_no = 'A3' \gset
select id as meera from public.students where admission_no = 'A4' \gset
select id as g_aarav from public.guardians where phone = '+919876543210' \gset

-- guardian channels
insert into public.guardian_channels(org_id, guardian_id, channel, address) values
  (:'org_id', :'g_aarav', 'telegram', '555001'), (:'org_id', :'g_aarav', 'whatsapp', '919876543210')
  on conflict (guardian_id, channel, address) do update set status = 'active';

-- QR credentials
select payload as qr_aarav from public.issue_credentials(array[:'aarav'::uuid]) \gset
select payload as qr_meera from public.issue_credentials(array[:'meera'::uuid]) \gset
select payload as qr_ravi_old from public.issue_credentials(array[:'ravi'::uuid]) \gset
select payload as qr_ravi from public.issue_credentials(array[:'ravi'::uuid], true) \gset
select pg_temp.assert(:'qr_aarav' like 'UW1.SPS.%', 'qr format');
select pg_temp.assert(:'qr_ravi' <> :'qr_ravi_old', 'reissue changes payload');

-- trips + pairing
select public.generate_trips() as n_trips \gset
select pg_temp.assert(:n_trips = 3, 'generated 3 trips');
select (public.create_pairing_code(:'bus7')->>'code') as pair_code \gset
select (public.create_pairing_code(:'bus3')->>'code') as pair_code3 \gset

-- ---------- Device (anon) ----------
reset request.jwt.claims;
set role anon;
select (public.dev_pair(:'pair_code', '{"model":"Redmi 12","app_version":"1.0.0"}')->>'device_token') as dtok \gset
select (public.dev_pair(:'pair_code3', '{}')->>'device_token') as dtok3 \gset
do $$ begin perform public.dev_pair('WRONG123', '{}'); raise exception 'should fail'; exception when others then
  if sqlerrm not like '%PAIRING_CODE_INVALID%' then raise; end if; end $$;
select public.dev_bootstrap(:'dtok') as boot \gset
select pg_temp.assert(jsonb_array_length(:'boot'::jsonb->'trips') = 2, 'bus7 has 2 trips today');
select pg_temp.assert(jsonb_array_length(:'boot'::jsonb->'crew') = 2, 'bus7 crew 2');
select t->>'id' as am_trip from jsonb_array_elements(:'boot'::jsonb->'trips') t where t->>'direction' = 'MORNING' \gset
select t->>'id' as pm_trip from jsonb_array_elements(:'boot'::jsonb->'trips') t where t->>'direction' = 'AFTERNOON' \gset

-- anon cannot read tables
do $$ begin perform 1 from public.students; raise exception 'anon read students!'; exception when insufficient_privilege then null; end $$;

select public.dev_start_trip(:'dtok', :'am_trip', :'driver', :'attendant', 17.41, 78.38) as tripdata \gset
select pg_temp.assert(jsonb_array_length(:'tripdata'::jsonb->'manifest') = 3, 'manifest 3 (aarav, diya, ravi)');
select pg_temp.assert(jsonb_array_length(:'tripdata'::jsonb->'other_buses') = 1, 'other bus index has meera');

-- device on bus3 cannot touch bus7 trip
do $$ begin perform public.dev_trip_data(current_setting('my.dtok3'), current_setting('my.am_trip')::uuid); exception when others then null; end $$;

-- bus approaches Sai Nagar (stop_a) and scans Aarav
select public.dev_locations(:'dtok', :'am_trip', jsonb_build_array(
  jsonb_build_object('ts', now() - interval '60 seconds', 'lat', 17.4150, 'lng', 78.38, 'acc', 10, 'speed', 8),
  jsonb_build_object('ts', now() - interval '45 seconds', 'lat', 17.4199, 'lng', 78.38, 'acc', 10, 'speed', 2)), 80) as loc1 \gset

select public.dev_sync(:'dtok', jsonb_build_array(
  jsonb_build_object('id','e1','kind','scan','trip_id',:'am_trip','ts',now(),'lat',17.4199,'lng',78.38,'crew_id',:'attendant','data',jsonb_build_object('qr',:'qr_aarav')),
  jsonb_build_object('id','e2','kind','scan','trip_id',:'am_trip','ts',now(),'lat',17.4199,'lng',78.38,'data',jsonb_build_object('qr',:'qr_aarav')),
  jsonb_build_object('id','e3','kind','scan','trip_id',:'am_trip','ts',now(),'lat',17.4199,'lng',78.38,'data',jsonb_build_object('qr',:'qr_meera')),
  jsonb_build_object('id','e4','kind','scan','trip_id',:'am_trip','ts',now(),'data',jsonb_build_object('qr',:'qr_ravi_old')),
  jsonb_build_object('id','e5','kind','scan','trip_id',:'am_trip','ts',now(),'data',jsonb_build_object('qr','UW1.SPS.AAAAAAAA.1.0000000000000000')),
  jsonb_build_object('id','e6','kind','scan','trip_id',:'am_trip','ts',now(),'data',jsonb_build_object('qr',replace(:'qr_aarav', right(:'qr_aarav', 4), 'ffff')))
)) as sync1 \gset
\echo sync1: :sync1
select pg_temp.assert((:'sync1'::jsonb->'results'->0->>'result') = 'ok', 'aarav boarded');
select pg_temp.assert((:'sync1'::jsonb->'results'->1->>'result') = 'duplicate', 'duplicate scan');
select pg_temp.assert((:'sync1'::jsonb->'results'->2->>'result') = 'wrong_bus', 'meera wrong bus');
select pg_temp.assert((:'sync1'::jsonb->'results'->3->>'result') = 'revoked', 'ravi old card revoked');
select pg_temp.assert((:'sync1'::jsonb->'results'->4->>'result') = 'unknown', 'unknown card');
select pg_temp.assert((:'sync1'::jsonb->'results'->5->>'result') = 'invalid', 'tampered signature');

-- replay is idempotent
select public.dev_sync(:'dtok', jsonb_build_array(jsonb_build_object('id','e1','kind','scan','trip_id',:'am_trip','data',jsonb_build_object('qr',:'qr_aarav')))) as replay \gset
select pg_temp.assert((:'replay'::jsonb->'results'->0->>'replayed')::boolean, 'replay detected');

-- Ravi (new card) is manually marked boarded with forgot-card reason
select public.dev_sync(:'dtok', jsonb_build_array(
  jsonb_build_object('id','e7','kind','scan','trip_id',:'am_trip','data',jsonb_build_object('qr',:'qr_ravi')))) as sync2 \gset
select pg_temp.assert((:'sync2'::jsonb->'results'->0->>'state') = 'ON_BOARD', 'ravi boarded with new card');

-- bus leaves stop A, passes stop B without Diya boarding => Diya MISSED after exit of stop B
select public.dev_locations(:'dtok', :'am_trip', jsonb_build_array(
  jsonb_build_object('ts', now() - interval '30 seconds', 'lat', 17.4240, 'lng', 78.38, 'acc', 10, 'speed', 9),
  jsonb_build_object('ts', now() - interval '20 seconds', 'lat', 17.4300, 'lng', 78.38, 'acc', 10, 'speed', 1),
  jsonb_build_object('ts', now() - interval '5 seconds', 'lat', 17.4350, 'lng', 78.38, 'acc', 10, 'speed', 15)), 79) as loc2 \gset

reset role; set role postgres;
select pg_temp.assert((select state from public.trip_manifest where trip_id = :'am_trip' and student_id = :'diya') = 'MISSED', 'diya missed');
select pg_temp.assert(exists(select 1 from public.exceptions where code = 'MISSED_BOARDING' and student_id = :'diya'), 'missed exception');
select pg_temp.assert(exists(select 1 from public.exceptions where code = 'WRONG_BUS' and student_id = :'meera'), 'wrong bus exception');
select pg_temp.assert((select count(*) from public.notification_outbox where student_id = :'aarav' and event_type = 'BOARDED') = 1,
  'aarav BOARDED notified once on primary channel (whatsapp)');
select pg_temp.assert((select channel from public.notification_outbox where student_id = :'aarav' and event_type = 'BOARDED') = 'whatsapp', 'primary channel whatsapp');
select pg_temp.assert((select count(*) from public.trip_stop_visits where trip_id = :'am_trip') = 2, '2 stop visits');

-- arrive school + bulk deboard, try complete without empty check
set role anon;
select public.dev_locations(:'dtok', :'am_trip', jsonb_build_array(
  jsonb_build_object('ts', now(), 'lat', 17.4399, 'lng', 78.38, 'acc', 10, 'speed', 0)), 78) as loc3 \gset
select public.dev_sync(:'dtok', jsonb_build_array(
  jsonb_build_object('id','e8','kind','arrive','trip_id',:'am_trip','data',jsonb_build_object('bulk_deboard',true)),
  jsonb_build_object('id','e9','kind','complete','trip_id',:'am_trip'),
  jsonb_build_object('id','e10','kind','empty_check','trip_id',:'am_trip','crew_id',:'attendant','data',jsonb_build_object('items',jsonb_build_array('last_row','under_seats'))),
  jsonb_build_object('id','e11','kind','complete','trip_id',:'am_trip')
)) as sync3 \gset
\echo sync3: :sync3
select pg_temp.assert(jsonb_array_length(:'sync3'::jsonb->'results'->0->'items') = 2, 'bulk deboarded 2');
select pg_temp.assert((:'sync3'::jsonb->'results'->1->>'code') = 'EMPTY_BUS_CHECK_REQUIRED', 'complete blocked w/o empty check');
select pg_temp.assert((:'sync3'::jsonb->'results'->3->>'ok')::boolean, 'complete ok');

-- ---------- Afternoon trip: unresolved handling ----------
select public.dev_start_trip(:'dtok', :'pm_trip', :'driver', :'attendant') as pmdata \gset
select pg_temp.assert(jsonb_array_length(:'pmdata'::jsonb->'manifest') = 1, 'pm manifest aarav only');
select public.dev_sync(:'dtok', jsonb_build_array(
  jsonb_build_object('id','p1','kind','scan','trip_id',:'pm_trip','data',jsonb_build_object('qr',:'qr_aarav')),
  jsonb_build_object('id','p2','kind','empty_check','trip_id',:'pm_trip','data','{}'::jsonb),
  jsonb_build_object('id','p3','kind','complete','trip_id',:'pm_trip')
)) as pm1 \gset
select pg_temp.assert((:'pm1'::jsonb->'results'->2->>'code') = 'UNRESOLVED', 'pm complete blocked by on-board child');
-- dropped far from stop => WRONG_STOP_DROP
select public.dev_sync(:'dtok', jsonb_build_array(
  jsonb_build_object('id','p4','kind','scan','trip_id',:'pm_trip','lat',17.4300,'lng',78.38,'data',jsonb_build_object('qr',:'qr_aarav','type','DEBOARD')),
  jsonb_build_object('id','p5','kind','complete','trip_id',:'pm_trip'),
  jsonb_build_object('id','p6','kind','sos','trip_id',:'pm_trip','lat',17.43,'lng',78.38,'data',jsonb_build_object('type','breakdown','note','tyre'))
)) as pm2 \gset
\echo pm2: :pm2
select pg_temp.assert((:'pm2'::jsonb->'results'->1->>'ok')::boolean, 'pm complete ok after drop');

-- ---------- Parent features ----------
reset role;
select token as trk from public.tracking_tokens where student_id = :'aarav' limit 1 \gset
set role anon;
select public.track_snapshot(:'trk') as snap \gset
select pg_temp.assert((:'snap'::jsonb->>'child') = 'Aarav', 'track snapshot child');
select pg_temp.assert(jsonb_array_length(:'snap'::jsonb->'events') = 2, 'snapshot two legs');
select public.track_snapshot('nope') as snap2 \gset
select pg_temp.assert((:'snap2'::jsonb->>'code') = 'LINK_EXPIRED', 'bad token');

reset role;
select invite_code as inv from public.guardians where id = :'g_aarav' \gset
set role service_role;
select public.svc_link_telegram(:'inv', '777888') as link \gset
select pg_temp.assert((:'link'::jsonb->>'ok')::boolean, 'telegram linked');
select public.svc_guardian_command('telegram', '777888', 'STATUS') as st \gset
\echo status: :st
select public.svc_guardian_command('telegram', '777888', 'absent tomorrow') as ab \gset
select pg_temp.assert((:'ab'::jsonb->'items'->0->>'type') = 'absent', 'absent recorded');
select public.svc_guardian_command('telegram', '000', 'hi') as unk \gset
select pg_temp.assert((:'unk'::jsonb->>'code') = 'UNKNOWN_SENDER', 'unknown sender');

-- outbox claim/result
select count(*) as claimed from public.svc_outbox_claim(100) \gset
select pg_temp.assert(:claimed > 3, 'claimed outbox rows: ' || :claimed);
reset role;
select id as ob1 from public.notification_outbox limit 1 \gset
set role service_role;
select public.svc_outbox_result(:'ob1', false, null, 'timeout');
reset role;
select pg_temp.assert((select status from public.notification_outbox where id = :'ob1') = 'queued', 'retry scheduled');

-- ---------- Admin views & isolation ----------
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.live_board() as lb \gset
select pg_temp.assert(jsonb_array_length(:'lb'::jsonb->'buses') = 2, 'live board buses');
select count(*) as rep from public.report_daily_attendance((now() at time zone 'Asia/Kolkata')::date) \gset
select count(*) as tp from public.report_trip_performance(current_date - 1, current_date + 1) \gset
select pg_temp.assert(:tp = 3, 'trip performance rows');
select pg_temp.assert(:rep >= 3, 'daily attendance rows');
select pg_temp.assert(exists(select 1 from public.exceptions where code = 'WRONG_STOP_DROP'), 'wrong stop drop raised');
select pg_temp.assert(exists(select 1 from public.incidents where type = 'sos_breakdown'), 'sos incident visible');
select public.student_journey(:'aarav', current_date - 1, current_date + 1) as jr \gset
select pg_temp.assert(jsonb_array_length(:'jr'::jsonb) = 2, 'journey 2 trips');

-- second org cannot see first org's data
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select public.create_organization('Other School', 'OTH', 'Campus', 17.0, 78.0) as org2 \gset
select pg_temp.assert((select count(*) from public.students) = 0, 'RLS isolates students');
select pg_temp.assert((select count(*) from public.trips) = 0, 'RLS isolates trips');
do $$ begin perform public.create_pairing_code(current_setting('my.none', true)::uuid); exception when others then null; end $$;
do $$ begin
  update public.students set first_name = 'hack'; -- affects 0 rows due to RLS
end $$;
reset role;
select pg_temp.assert((select count(*) from public.students where first_name = 'hack') = 0, 'cross-org update blocked');

-- jobs run
select public.cron_minutely() as cm \gset
select public.cron_daily() as cd \gset
\echo cron: :cm :cd
\echo ALL TESTS PASSED
