-- ============================================================================
-- PG Manager - reset the public schema
--
-- DESTRUCTIVE. Drops every table, view, function and type in `public` and
-- recreates the empty schema with Supabase's standard grants, so
-- supabase/schema.sql can be applied to a clean slate.
--
--   supabase/reset.sql   ->   supabase/schema.sql   ->   supabase/seed.sql
--
-- BEFORE YOU RUN THIS
--   1. Download a backup: Supabase dashboard -> Database -> Backups, or
--      `supabase db dump`. There is no undo.
--   2. Note down the e-mail addresses that go in `admins` afterwards - the
--      allow-list is dropped with everything else.
--   3. Objects in the private storage bucket SURVIVE (they live in the storage
--      schema, not public). Re-create the bucket policies by re-running
--      schema.sql, which is what step 2 does for you.
--
-- Anything you create in `public` yourself is dropped too. That is the point of
-- this file; if that is not what you want, use supabase/repair.sql instead,
-- which never drops anything.
-- ============================================================================

-- Stop scheduled jobs first, so nothing tries to write into a schema that is
-- about to disappear. Missing in local Supabase, which is fine.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job;
  end if;
exception
  when others then null;  -- pg_cron present but no jobs scheduled
end;
$$;

-- The managed roles live in `auth`/`storage`, not `public`, so they are safe.
drop schema if exists public cascade;

create schema public;

-- Supabase's baseline grants for a fresh project schema. Without these the
-- anon/authenticated roles cannot read anything and every request 401s.
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on all tables in schema public to postgres, service_role;
grant all on all routines in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to postgres, service_role;
alter default privileges in schema public
  grant all on functions to postgres, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, service_role;

alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

-- Extensions Supabase provisions for new projects. `if not exists` keeps this
-- harmless on a project that already has them.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgjwt with schema extensions;

-- Anything created from now on lands in a schema the app does not search.
alter role authenticated set search_path = public, extensions;
alter role anon set search_path = public, extensions;

-- Tell PostgREST to pick the new schema up without a project restart.
notify pgrst, 'reload schema';

select 'public schema reset - now run supabase/schema.sql' as next_step;