\set ON_ERROR_STOP 1
\set QUIET 1
create or replace function pg_temp.ok(c boolean, msg text) returns text language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FAIL: %', msg; end if; return 'ok ' || msg; end $$;
insert into auth.users(id, email) values ('66666666-6666-6666-6666-666666666666', 'v3@school.test');
set role authenticated;
set request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated","email":"v3@school.test"}';
select public.create_organization('V3 School', 'VTH', 'Main', 17.45, 78.39) as org \gset
select public.create_demo_data() is not null as demo \gset
update public.crew_members set pin_hash = null where name like 'Padma%';
select pg_temp.ok((select count(*) from public.crew_pin_status() where not has_pin) = 1, 'one crew without pin');
select public.auto_crew_pins() as pins \gset
select pg_temp.ok(jsonb_array_length(:'pins'::jsonb) = 1 and (:'pins'::jsonb->0->>'pin') ~ '^\d{4}$', 'pin generated');
select id as s1, admission_no as a1 from public.students order by first_name limit 1 \gset
select pg_temp.ok(public.set_student_homes(jsonb_build_array(jsonb_build_object('student_id', :'s1', 'home_lat', 17.41, 'home_lng', 78.37, 'home_address', 'Road 1'))) = 1, 'homes saved');
select pg_temp.ok((select home_lat from public.students where id = :'s1') = 17.41, 'home lat');
select public.issue_credentials(array[:'s1'::uuid]) is not null as issued \gset
select pg_temp.ok(public.mark_cards_printed(array[:'s1'::uuid]) = 1, 'printed');
select public.issue_credentials(array[:'s1'::uuid], true) is not null as reissued \gset
select pg_temp.ok((select card_printed_at from public.students where id = :'s1') is null, 'reissue clears printed');
select pg_temp.ok((select count(*) from public.guardian_portal_tokens()) = 16, 'portal tokens');
reset role;
\echo SCHOOL AUTOMATION TESTS PASSED
