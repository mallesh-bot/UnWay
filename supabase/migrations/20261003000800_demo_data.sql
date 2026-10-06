-- =====================================================================
-- Demo data generator: lets a new school try UnWay end-to-end in minutes.
-- Creates 2 buses, crew (PIN 1234), 6 stops around the campus, 4 routes,
-- 16 students with guardians and assignments, and today's trips.
-- =====================================================================
create or replace function public.create_demo_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public._require_writer();
  c public.campuses%rowtype;
  v_bus1 uuid; v_bus2 uuid; v_d1 uuid; v_d2 uuid; v_a1 uuid; v_a2 uuid;
  v_stops uuid[] := '{}'; v_sid uuid; i int;
  v_r1am uuid; v_r1pm uuid; v_r2am uuid; v_r2pm uuid;
  v_student uuid; v_guardian uuid;
  names text[] := array['Aarav','Diya','Vihaan','Ananya','Arjun','Saanvi','Reyansh','Ira','Kabir','Myra','Advik','Navya','Rudra','Kiara','Ishaan','Aadhya'];
  lasts text[] := array['Reddy','Rao','Sharma','Naidu','Kumar','Varma','Patel','Iyer'];
  stop_names text[] := array['Sai Nagar Gate','Lake View Colony','Temple Junction','Ratnadeep Circle','Green Park','Railway Colony'];
  offs double precision[][] := array[[-0.020,-0.012],[-0.014,-0.006],[-0.008,-0.002],[0.018,0.010],[0.012,0.006],[0.006,0.003]];
  v_sec text;
begin
  select * into c from public.campuses where org_id = v_org order by created_at limit 1;
  if c.lat is null then raise exception 'Set the school location in Settings first' using errcode = 'P0001'; end if;
  if exists (select 1 from public.buses where org_id = v_org and display_number in ('D1','D2')) then
    raise exception 'Demo data already exists' using errcode = 'P0001';
  end if;

  insert into public.buses(org_id, display_number, registration_no, capacity) values (v_org, 'D1', 'TS09DEMO01', 40) returning id into v_bus1;
  insert into public.buses(org_id, display_number, registration_no, capacity) values (v_org, 'D2', 'TS09DEMO02', 40) returning id into v_bus2;
  insert into public.crew_members(org_id, name, role, phone, licence_no, licence_valid_until) values (v_org, 'Ramesh (demo)', 'driver', '+919000000001', 'TS0920190001', current_date + 400) returning id into v_d1;
  insert into public.crew_members(org_id, name, role, phone, licence_no, licence_valid_until) values (v_org, 'Suresh (demo)', 'driver', '+919000000002', 'TS0920190002', current_date + 20) returning id into v_d2;
  insert into public.crew_members(org_id, name, role, phone) values (v_org, 'Lakshmi (demo)', 'attendant', '+919000000003') returning id into v_a1;
  insert into public.crew_members(org_id, name, role, phone) values (v_org, 'Padma (demo)', 'attendant', '+919000000004') returning id into v_a2;
  update public.crew_members set pin_hash = public.sha256_hex(id::text || ':1234') where id in (v_d1, v_d2, v_a1, v_a2);
  insert into public.bus_crew(org_id, bus_id, crew_id) values (v_org, v_bus1, v_d1), (v_org, v_bus1, v_a1), (v_org, v_bus2, v_d2), (v_org, v_bus2, v_a2);

  for i in 1..6 loop
    insert into public.stops(org_id, campus_id, name, lat, lng, radius_m)
    values (v_org, c.id, stop_names[i], c.lat + offs[i][1], c.lng + offs[i][2], 80) returning id into v_sid;
    v_stops := v_stops || v_sid;
  end loop;

  insert into public.routes(org_id, campus_id, code, name, direction, default_bus_id, days_mask, scheduled_start)
    values (v_org, c.id, 'D1', 'Demo south route', 'MORNING', v_bus1, 127, '07:15') returning id into v_r1am;
  insert into public.routes(org_id, campus_id, code, name, direction, default_bus_id, days_mask, scheduled_start)
    values (v_org, c.id, 'D1-PM', 'Demo south route (home)', 'AFTERNOON', v_bus1, 127, '15:10') returning id into v_r1pm;
  insert into public.routes(org_id, campus_id, code, name, direction, default_bus_id, days_mask, scheduled_start)
    values (v_org, c.id, 'D2', 'Demo north route', 'MORNING', v_bus2, 127, '07:20') returning id into v_r2am;
  insert into public.routes(org_id, campus_id, code, name, direction, default_bus_id, days_mask, scheduled_start)
    values (v_org, c.id, 'D2-PM', 'Demo north route (home)', 'AFTERNOON', v_bus2, 127, '15:15') returning id into v_r2pm;
  insert into public.route_stops(org_id, route_id, stop_id, seq, planned_offset_min) values
    (v_org, v_r1am, v_stops[1], 1, 0), (v_org, v_r1am, v_stops[2], 2, 8), (v_org, v_r1am, v_stops[3], 3, 15),
    (v_org, v_r1pm, v_stops[3], 1, 10), (v_org, v_r1pm, v_stops[2], 2, 17), (v_org, v_r1pm, v_stops[1], 3, 25),
    (v_org, v_r2am, v_stops[4], 1, 0), (v_org, v_r2am, v_stops[5], 2, 7), (v_org, v_r2am, v_stops[6], 3, 13),
    (v_org, v_r2pm, v_stops[6], 1, 8), (v_org, v_r2pm, v_stops[5], 2, 14), (v_org, v_r2pm, v_stops[4], 3, 21);

  for i in 1..16 loop
    insert into public.students(org_id, campus_id, admission_no, first_name, last_name, class_name, section, handover_required, special_care_note)
    values (v_org, c.id, 'DEMO' || lpad(i::text, 3, '0'), names[i], lasts[1 + (i % 8)], (1 + (i % 7))::text, case when i % 2 = 0 then 'A' else 'B' end,
            i in (3, 11), case when i = 5 then 'Asthma: inhaler in bag' end)
    returning id into v_student;
    insert into public.guardians(org_id, name, relation, phone, language)
    values (v_org, 'Parent of ' || names[i], case when i % 2 = 0 then 'Mother' else 'Father' end, '+9199000' || lpad(i::text, 5, '0'),
            case when i % 3 = 0 then 'te' when i % 3 = 1 then 'en' else 'hi' end)
    returning id into v_guardian;
    insert into public.student_guardians(org_id, student_id, guardian_id, is_primary) values (v_org, v_student, v_guardian, true);
    if i <= 8 then
      insert into public.transport_assignments(org_id, student_id, direction, route_id, stop_id) values
        (v_org, v_student, 'MORNING', v_r1am, v_stops[1 + (i % 3)]), (v_org, v_student, 'AFTERNOON', v_r1pm, v_stops[1 + (i % 3)]);
    else
      insert into public.transport_assignments(org_id, student_id, direction, route_id, stop_id) values
        (v_org, v_student, 'MORNING', v_r2am, v_stops[4 + (i % 3)]), (v_org, v_student, 'AFTERNOON', v_r2pm, v_stops[4 + (i % 3)]);
    end if;
  end loop;

  perform public.generate_trips_for_org(v_org, public._org_today(v_org));
  perform public._audit(v_org, 'user', auth.uid()::text, 'demo_data_created', 'organization', v_org::text, null);
  return jsonb_build_object('ok', true, 'buses', 2, 'students', 16, 'crew_pin', '1234');
end $$;

revoke all on function public.create_demo_data() from public, anon;
grant execute on function public.create_demo_data() to authenticated;
