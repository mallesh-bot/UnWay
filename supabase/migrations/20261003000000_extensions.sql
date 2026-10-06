-- Enable Supabase extensions when available (ignored on plain Postgres).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  begin create extension if not exists pg_cron with schema pg_catalog; exception when others then raise notice 'pg_cron not available: %', sqlerrm; end;
  begin create extension if not exists pg_net with schema extensions; exception when others then raise notice 'pg_net not available: %', sqlerrm; end;
end $$;
