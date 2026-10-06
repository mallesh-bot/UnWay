\set ON_ERROR_STOP 1
\set QUIET 1
insert into auth.users(id, email) values ('33333333-3333-3333-3333-333333333333', 'demo@school.test');
set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select public.create_organization('Demo School', 'DMO', 'Main', 17.45, 78.39) \gset
select public.create_demo_data() as demo \gset
\echo demo: :demo
select count(*) as n from public.students \gset
do $$ begin if current_setting('my.x', true) is null then null; end if; end $$;
select case when :n = 16 then 'ok' else 'FAIL students ' || :n end as students_check;
select count(*) as trips from public.trips where trip_date = (now() at time zone 'Asia/Kolkata')::date \gset
select case when :trips = 4 then 'ok' else 'FAIL trips' end as trips_check;
select (public.create_pairing_code(id)->>'code') as code from public.buses where display_number = 'D1' \gset
reset role; reset request.jwt.claims; set role anon;
select (public.dev_pair(:'code','{}')->>'device_token') as tok \gset
select jsonb_array_length(public.dev_bootstrap(:'tok')->'crew') as crew \gset
select case when :crew = 2 then 'ok' else 'FAIL crew' end as crew_check;
\echo DEMO TESTS PASSED
