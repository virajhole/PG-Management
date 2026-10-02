-- ============================================================================
-- ACCESS CONTROL: the admins allowlist + Google sign-in
--
-- Appended last by scripts/build-schema.mjs. Everything above this section was
-- written when one account owned one PG and every row was scoped by
-- `user_id = auth.uid()`. Google login changes two things:
--
--   1. A stranger can now complete an OAuth handshake. Signing in is no longer
--      proof of anything, so the `admins` table decides who may read a ledger.
--   2. The owner can put a colleague on the team. Several auth accounts then
--      share one ledger, so "whose rows" can no longer be answered with
--      `auth.uid()` alone.
--
-- Both are solved by one resolver, `app_scope_user_id()`: the single uuid that
-- owns the ledger for the current caller. Every policy, every RPC and the
-- storage policies route through it, so there is exactly one place that decides
-- who can see what. Re-running this file is safe.
-- ============================================================================

create table if not exists public.admins (
  email      text primary key,
  role       text not null default 'admin' check (role in ('owner', 'admin', 'staff')),
  -- The auth account this address signs in as. Filled in by bootstrap_owner()
  -- the first time the address is seen, so the shared ledger keeps one stable
  -- owner partition even though several people sign in.
  user_id    uuid,
  created_at timestamptz not null default now()
);

create index if not exists admins_role_idx on public.admins (role);
create index if not exists admins_user_id_idx on public.admins (user_id);

comment on table public.admins is
  'Allow-list of e-mail addresses allowed to open this PG. Checked by is_admin().';

-- --------------------------------------------------------------- is_admin()
-- The single question every policy asks. SECURITY DEFINER so it can read
-- `admins` without recursing through the RLS policy that calls it, and
-- STABLE so the planner evaluates it once per statement.
--
-- SECURITY DEFINER functions must pin their search_path, otherwise a caller who
-- can create objects in a writable schema could shadow the function body.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Is anyone on the team yet? Distinguishes a fresh project from a real one.
create or replace function public.has_admins()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins);
$$;

revoke execute on function public.has_admins() from public, anon;
grant execute on function public.has_admins() to authenticated;

-- Any team role, for a staff-only check.
create or replace function public.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(auth.jwt() ->> 'email')
      and role = any (p_roles)
  );
$$;

revoke execute on function public.has_role(text[]) from public, anon;
grant execute on function public.has_role(text[]) to authenticated;

-- ------------------------------------------------------- app_scope_user_id()
-- "Whose ledger is the caller working on?" One uuid, used by every policy,
-- every RPC and the storage policies.
--
--   not signed in            -> null, so every `user_id = <this>` is false
--   allow-list still empty   -> the caller's own uid (a project created before
--                              the allow-list existed keeps working, and a
--                              brand-new project is owned by whoever signs in
--                              first)
--   allow-list has rows      -> the owner partition, but ONLY for a listed
--                              address; a stranger gets null and therefore
--                              zero rows and "Incorrect login credentials"
--                              from every write RPC
create or replace function public.app_scope_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then null
    when not public.has_admins() then auth.uid()
    when public.is_admin() then coalesce(
      (
        select a.user_id from public.admins a
        where a.user_id is not null
        order by a.created_at asc, a.email asc
        limit 1
      ),
      auth.uid()
    )
    else null
  end;
$$;

revoke execute on function public.app_scope_user_id() from public, anon;
grant execute on function public.app_scope_user_id() to authenticated;

comment on function public.app_scope_user_id() is
  'The uuid owning the ledger for the current caller; null when they may not see it.';

-- ---------------------------------------------------------- bootstrap_owner()
-- Solves the chicken-and-egg the allow-list would otherwise create: the table is
-- the only door, and it is empty until somebody opens it.
--
--   * On a project with no admins at all, the first account to sign in inserts
--     itself as the owner. Every later stranger is rejected.
--   * Otherwise it only records which auth account an address uses, so the
--     shared partition stays stable across sessions. It can never add somebody
--     who is not already listed, which is what makes it safe to call on every
--     sign-in.
create or replace function public.bootstrap_owner(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if v_email = '' then
    return false;
  end if;

  -- Refuse to bootstrap with somebody else's address: the caller's own JWT
  -- claim is the only address that may claim a virgin project.
  if not public.has_admins() and v_email <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    return false;
  end if;

  if not public.has_admins() then
    insert into public.admins (email, role, user_id)
    values (v_email, 'admin', auth.uid())
    on conflict (email) do update
      set user_id = coalesce(public.admins.user_id, excluded.user_id);
    return true;
  end if;

  update public.admins
     set user_id = auth.uid()
   where lower(email) = v_email
     and user_id is null;

  return public.is_admin();
end;
$$;

revoke execute on function public.bootstrap_owner(text) from public, anon;
grant execute on function public.bootstrap_owner(text) to authenticated;

-- ------------------------------------------------------- admins table's RLS
-- Listing and editing the team is an admin-only action: staff can use the app
-- but cannot hand out access. A listed account may also always read its own
-- row, which is how the client answers "am I allowed?" without a special case.
alter table public.admins enable row level security;

drop policy if exists "read own allowlist entry" on public.admins;
create policy "read own allowlist entry" on public.admins
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "admins manage the team" on public.admins;
create policy "admins manage the team" on public.admins
  to authenticated
  using (public.is_admin() and public.has_role(array['owner', 'admin']))
  with check (public.is_admin() and public.has_role(array['owner', 'admin']));

grant select, insert, update, delete on public.admins to authenticated;