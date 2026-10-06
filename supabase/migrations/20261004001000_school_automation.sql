-- v2: small server helpers for school-side automation

-- Save students' home locations (from CSV import or geocoding). rows: [{student_id | admission_no, home_address, home_lat, home_lng}]
create or replace function public.set_student_homes(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer(); r jsonb; v_n int := 0; v_id uuid;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_id := null;
    if coalesce(r->>'student_id', '') <> '' then
      select id into v_id from public.students where org_id = v_org and id = (r->>'student_id')::uuid;
    elsif coalesce(trim(r->>'admission_no'), '') <> '' then
      select id into v_id from public.students where org_id = v_org and admission_no = trim(r->>'admission_no');
    end if;
    continue when v_id is null;
    update public.students set
      home_address = coalesce(nullif(trim(r->>'home_address'), ''), home_address),
      home_lat = coalesce(nullif(r->>'home_lat', '')::double precision, home_lat),
      home_lng = coalesce(nullif(r->>'home_lng', '')::double precision, home_lng)
     where id = v_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
grant execute on function public.set_student_homes(jsonb) to authenticated;

-- Give every active crew member without a PIN a random 4-digit PIN. Returns the new PINs once (print them).
create or replace function public.auto_crew_pins(p_reset_all boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer(); c record; v_pin text; v_out jsonb := '[]'::jsonb;
begin
  for c in select * from public.crew_members where org_id = v_org and active and (p_reset_all or pin_hash is null) order by role, name loop
    v_pin := lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    update public.crew_members set pin_hash = public.sha256_hex(c.id::text || ':' || v_pin) where id = c.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', c.id, 'name', c.name, 'role', c.role, 'phone', c.phone, 'pin', v_pin,
      'bus', (select string_agg(b.display_number, ', ') from public.bus_crew bc join public.buses b on b.id = bc.bus_id where bc.crew_id = c.id)));
  end loop;
  perform public._audit(v_org, 'user', auth.uid()::text, 'crew_pins_generated', 'crew_members', null, jsonb_build_object('count', jsonb_array_length(v_out)));
  return v_out;
end $$;
grant execute on function public.auto_crew_pins(boolean) to authenticated;

create or replace function public.crew_pin_status() returns table(id uuid, has_pin boolean)
language sql stable security definer set search_path = public as $$
  select id, pin_hash is not null from public.crew_members where org_id = public.my_org()
$$;
grant execute on function public.crew_pin_status() to authenticated;

-- Cards: remember what was printed; a re-issued card needs printing again
create or replace function public.mark_cards_printed(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._require_writer(); v_n int;
begin
  update public.students set card_printed_at = now() where org_id = v_org and id = any(p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.mark_cards_printed(uuid[]) to authenticated;

create or replace function public._card_reprint_trigger() returns trigger
language plpgsql as $$
begin
  if new.cred_version is distinct from old.cred_version then new.card_printed_at := null; end if;
  return new;
end $$;
drop trigger if exists students_card_reprint on public.students;
create trigger students_card_reprint before update of cred_version on public.students
  for each row execute function public._card_reprint_trigger();

-- Parent links for the school's Parents page (portal link per guardian)
create or replace function public.guardian_portal_tokens() returns table(guardian_id uuid, portal_token text)
language sql stable security definer set search_path = public as $$
  select id, portal_token from public.guardians where org_id = public.my_org() and public.my_role() in ('school_admin','transport_manager')
$$;
grant execute on function public.guardian_portal_tokens() to authenticated;
