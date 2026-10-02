-- ============================================================================
-- PG Manager - repair / bring an existing database up to date
--
-- NON-DESTRUCTIVE. Contains only "create ... if not exists" and
-- "add column if not exists". Nothing is dropped, truncated or overwritten, so
-- it is safe to run against a populated production project.
--
-- Use this when:
--   * the app was pointed at a project that only has migrations 001-002
--   * a screen says "run the 00X migration" (complaints, assets, meters…)
--   * you upgraded from before Google login and need the allow-list
--
-- For a clean rebuild instead, use supabase/reset.sql + supabase/schema.sql.
--
-- Running this twice changes nothing the second time.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- access
-- Google login needs the allow-list and its helpers before anything else:
-- every other table's policy is rewritten to route through
-- app_scope_user_id().
create table if not exists public.admins (
  email      text primary key,
  role       text not null default 'admin' check (role in ('owner', 'admin', 'staff')),
  user_id    uuid,
  created_at timestamptz not null default now()
);

create index if not exists admins_role_idx on public.admins (role);
create index if not exists admins_user_id_idx on public.admins (user_id);

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

create or replace function public.has_admins()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins);
$$;

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

-- --------------------------------------------------- 002 rooms & lifecycle
create table if not exists public.rooms (
  id                     text primary key,
  user_id                uuid not null default public.app_scope_user_id(),
  floor                  int  not null default 0,
  room_no                text not null default '',
  sharing_type           int  not null default 1 check (sharing_type between 1 and 5),
  monthly_rent           numeric(12,2),
  has_ac                 boolean not null default false,
  has_attached_bathroom  boolean not null default false,
  notes                  text not null default '',
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists public.room_history (
  id          text primary key,
  user_id     uuid not null default public.app_scope_user_id(),
  customer_id text not null references public.customers (id) on delete cascade,
  room_id     text references public.rooms (id) on delete set null,
  bed_no      text not null default '',
  from_date   date not null default current_date,
  to_date     date,
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.expenses (
  id         text primary key,
  user_id    uuid not null default public.app_scope_user_id(),
  category   text not null default 'other',
  amount     numeric(12,2) not null default 0,
  date       date not null default current_date,
  note       text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id          text primary key,
  user_id     uuid not null default public.app_scope_user_id(),
  action      text not null default '',
  entity_type text not null default '',
  entity_id   text,
  summary     text not null default '',
  amount      numeric(12,2),
  created_at  timestamptz not null default now()
);

create index if not exists rooms_user_idx   on public.rooms (user_id, floor);
create index if not exists room_history_idx on public.room_history (user_id, customer_id);
create index if not exists expenses_idx     on public.expenses (user_id, date desc);
create index if not exists audit_log_idx    on public.audit_log (user_id, created_at desc);

alter table public.customers add column if not exists room_id text references public.rooms (id) on delete set null;
alter table public.customers add column if not exists vacated_at date;
alter table public.customers add column if not exists notice_given_at date;
alter table public.customers add column if not exists notice_note text;
alter table public.customers add column if not exists expected_leaving_date date;
alter table public.customers add column if not exists damage_charges numeric(12,2) default 0;
alter table public.customers add column if not exists deposit_refund numeric(12,2) default 0;

-- 004 tenant tooling: the profile fields the tenant form and agreements use.
alter table public.customers add column if not exists birthday date;
alter table public.customers add column if not exists anniversary date;
alter table public.customers add column if not exists agreement_end_date date;

create index if not exists customers_room_idx on public.customers (room_id);

-- --------------------------------------------------------- 003 operations
create table if not exists public.complaints (
  id            text primary key,
  user_id       uuid not null default public.app_scope_user_id(),
  title         text not null default '',
  category      text not null default 'other'
    check (category in ('electricity', 'water', 'wifi', 'cleaning', 'furniture', 'other')),
  priority      text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status        text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  room_no       text not null default '',
  customer_id   text references public.customers (id) on delete set null,
  description   text not null default '',
  photo_id      text,
  assigned_to   text not null default '',
  resolved_date date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.notices (
  id         text primary key,
  user_id    uuid not null default public.app_scope_user_id(),
  title      text not null default '',
  body       text not null default '',
  date       date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enquiries (
  id                 text primary key,
  user_id            uuid not null default public.app_scope_user_id(),
  name               text not null default '',
  phone              text not null default '',
  preferred_sharing  int,
  budget             numeric(12,2),
  expected_join_date date,
  status             text not null default 'new'
    check (status in ('new', 'contacted', 'visited', 'joined', 'lost')),
  note               text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.visitors (
  id            text primary key,
  user_id       uuid not null default public.app_scope_user_id(),
  name          text not null default '',
  phone         text not null default '',
  visiting_whom text not null default '',
  purpose       text not null default '',
  in_time       text not null default '',
  out_time      text not null default '',
  date          date not null default current_date,
  created_at    timestamptz not null default now()
);

create index if not exists complaints_user_idx  on public.complaints (user_id, status, created_at desc);
create index if not exists notices_user_idx     on public.notices (user_id, date desc);
create index if not exists enquiries_user_idx   on public.enquiries (user_id, status, created_at desc);
create index if not exists visitors_user_idx    on public.visitors (user_id, date desc);

-- -------------------------------------------------------- 004 tenant tools
create table if not exists public.agreements (
  id             text primary key,
  user_id        uuid not null default public.app_scope_user_id(),
  customer_id    text not null references public.customers (id) on delete cascade,
  rent_amount    numeric(12,2) not null default 0,
  deposit_amount numeric(12,2) not null default 0,
  start_date     date not null default current_date,
  end_date       date,
  signature_path text,
  pdf_path       text,
  signed_at      timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.rent_revisions (
  id             text primary key,
  user_id        uuid not null default public.app_scope_user_id(),
  customer_id    text not null references public.customers (id) on delete cascade,
  old_rent       numeric(12,2) not null default 0,
  new_rent       numeric(12,2) not null default 0,
  effective_date date not null default current_date,
  note           text not null default '',
  created_at     timestamptz not null default now()
);

create table if not exists public.meter_readings (
  id                text primary key,
  user_id           uuid not null default public.app_scope_user_id(),
  room_id           text references public.rooms (id) on delete cascade,
  room_no           text not null default '',
  month             text not null default '',
  previous_reading  numeric(12,2) not null default 0,
  current_reading   numeric(12,2) not null default 0,
  rate_per_unit     numeric(12,2) not null default 0,
  total_units       numeric(12,2) not null default 0,
  total_amount      numeric(12,2) not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.late_fees (
  id          text primary key,
  user_id     uuid not null default public.app_scope_user_id(),
  customer_id text not null references public.customers (id) on delete cascade,
  cycle_id    text references public.rent_cycles (id) on delete cascade,
  amount      numeric(12,2) not null default 0,
  days_late   int not null default 0,
  waived      boolean not null default false,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists agreements_user_idx    on public.agreements (user_id, customer_id);
create index if not exists rent_revisions_user_idx on public.rent_revisions (user_id, customer_id);
create index if not exists meter_readings_idx      on public.meter_readings (user_id, month desc);
create index if not exists late_fees_user_idx      on public.late_fees (user_id, customer_id);

-- ---------------------------------------------------- 005 optional extras
create table if not exists public.assets (
  id         text primary key,
  user_id    uuid not null default public.app_scope_user_id(),
  room_id    text references public.rooms (id) on delete cascade,
  room_no    text not null default '',
  item       text not null default '',
  quantity   int not null default 1,
  condition  text not null default 'good' check (condition in ('new', 'good', 'worn', 'broken')),
  note       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mess_menu (
  id         text primary key,
  user_id    uuid not null default public.app_scope_user_id(),
  day        text not null default '',
  meal       text not null default '',
  items      text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists assets_room_idx       on public.assets (user_id, room_id);
create unique index if not exists mess_menu_day_meal_idx on public.mess_menu (user_id, day, meal);

-- ------------------------------------------------- 004 settings additions
alter table public.settings add column if not exists upi_id text not null default '';
alter table public.settings add column if not exists late_fee_mode text not null default 'none'
  check (late_fee_mode in ('none', 'flat', 'percent'));
alter table public.settings add column if not exists late_fee_value numeric(12,2) not null default 0;
alter table public.settings add column if not exists late_fee_grace_days int not null default 0;
alter table public.settings add column if not exists late_fee_max numeric(12,2);
alter table public.settings add column if not exists mess_enabled boolean not null default false;
alter table public.settings add column if not exists mess_charges numeric(12,2) not null default 0;

-- ------------------------------------------------------- 006 transactions
-- `LATE_FEE` rows are written by record_flat_transaction; the check constraint
-- on an older install still forbids them, so widen it.
alter table public.transactions drop constraint if exists transactions_type_check;
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'transactions_type_check'
  ) then
    alter table public.transactions
      add constraint transactions_type_check
      check (type in ('RENT', 'LIGHT_BILL', 'DEPOSIT', 'REFUND', 'LATE_FEE', 'ADJUSTMENT'));
  end if;
end;
$$;

-- --------------------------------------------------------------- RLS
-- Re-applied (not merely enabled) so a project that still has the old
-- `user_id = auth.uid()` policies picks up the allow-list.
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'rent_cycles', 'light_bills', 'transactions', 'settings',
    'rooms', 'room_history', 'expenses', 'audit_log',
    'complaints', 'notices', 'enquiries', 'visitors',
    'agreements', 'rent_revisions', 'meter_readings', 'late_fees',
    'assets', 'mess_menu'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- Every owner-scoped table gets the same rule: your ledger, or nothing. Named
-- consistently so a later edit can drop them all with one pattern.
drop policy if exists "own customers"      on public.customers;
create policy "own customers"      on public.customers      to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own cycles"        on public.rent_cycles;
create policy "own cycles"        on public.rent_cycles    to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own light bills"   on public.light_bills;
create policy "own light bills"   on public.light_bills   to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own transactions"  on public.transactions;
create policy "own transactions"  on public.transactions  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own settings"      on public.settings;
create policy "own settings"      on public.settings      to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own rooms"         on public.rooms;
create policy "own rooms"         on public.rooms         to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own room history"  on public.room_history;
create policy "own room history"  on public.room_history  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own expenses"      on public.expenses;
create policy "own expenses"      on public.expenses      to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own audit log"     on public.audit_log;
create policy "own audit log"     on public.audit_log     to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own complaints"    on public.complaints;
create policy "own complaints"    on public.complaints    to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own notices"       on public.notices;
create policy "own notices"       on public.notices       to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own enquiries"     on public.enquiries;
create policy "own enquiries"     on public.enquiries     to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own visitors"      on public.visitors;
create policy "own visitors"      on public.visitors      to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own agreements"    on public.agreements;
create policy "own agreements"    on public.agreements    to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own rent revisions" on public.rent_revisions;
create policy "own rent revisions" on public.rent_revisions to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own meter readings" on public.meter_readings;
create policy "own meter readings" on public.meter_readings to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own late fees"     on public.late_fees;
create policy "own late fees"     on public.late_fees     to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own assets"        on public.assets;
create policy "own assets"        on public.assets        to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own mess menu"     on public.mess_menu;
create policy "own mess menu"     on public.mess_menu     to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());

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

-- -------------------------------------------------------------- storage
insert into storage.buckets (id, name, public)
values ('identity-docs', 'identity-docs', false)
on conflict (id) do nothing;

-- Paths are `{ledger owner}/c/{customerId}/...`, so the folder check has to use
-- the same resolver as the table policies.
drop policy if exists "identity-docs owner all" on storage.objects;
create policy "identity-docs owner all" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'identity-docs'
    and (storage.foldername(name))[1] = public.app_scope_user_id()::text
  )
  with check (
    bucket_id = 'identity-docs'
    and (storage.foldername(name))[1] = public.app_scope_user_id()::text
  );

-- ------------------------------------------------------------- privileges
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant execute on function public.is_admin()                  to authenticated;
grant execute on function public.has_admins()                to authenticated;
grant execute on function public.has_role(text[])            to authenticated;
grant execute on function public.app_scope_user_id()         to authenticated;
grant execute on function public.bootstrap_owner(text)      to authenticated;

select 'repair complete - check the Supabase logs for errors' as next_step;