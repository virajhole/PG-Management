-- ============================================================================
-- PG Manager - complete database schema
--
-- GENERATED FILE - do not edit by hand.
-- Rebuild with:  node scripts/build-schema.mjs
--
-- This is every migration (001-006) plus the access-control section, in
-- dependency order and safe to run more than once. Everything is
-- "create ... if not exists" / "drop policy if exists", so you can paste the
-- whole file into the Supabase SQL editor against a fresh project, against one
-- that already has the old migrations applied, or twice in a row.
--
-- To wipe and start over:      supabase/reset.sql, then this file.
-- To upgrade without losing data: supabase/repair.sql.
-- To add demo rows:            supabase/seed.sql.
--
-- Sections
--   1. 001 core ledger (customers, rent cycles, light bills, transactions, settings)
--   2. 002 rooms, occupancy and the tenant lifecycle
--   3. 003 complaints, notices, enquiries, visitors
--   4. 004 agreements, rent revisions, meter readings, late fees
--   5. 005 assets and mess menu
--   6. 006 record_flat_transaction RPC
--   7. Access control: admins allow-list, is_admin(), app_scope_user_id()
-- ============================================================================

-- ############################################################################
-- # SECTION: 001_init.sql
-- ############################################################################

create extension if not exists pgcrypto;

-- --------------------------------------------------------------- id helper
-- Client-generated text ids (PG-0001, cus_xxx, cyc_xxx, txn_xxx, bil_xxx,
-- img_xxx) are preserved as-is so an imported localStorage backup keeps every
-- cross-reference intact. Rows created by the RPCs use this helper.
create or replace function public.app_id(prefix text)
returns text
language sql
as $$
  select prefix || replace(gen_random_uuid()::text, '-', '');
$$;

-- ------------------------------------------------------------- date helpers
create or replace function public.month_end(d date)
returns date
language sql
immutable
as $$
  select (date_trunc('month', d) + interval '1 month' - interval '1 day')::date;
$$;

-- Move `anchor` forward `months_ahead` months while keeping the original
-- day-of-month `anchor_day`, clamping to the last day of the target month
-- (a 31st-joiner bills on the 29th/28th of February, never 1st of March).
create or replace function public.advance_due_date(anchor date, anchor_day int, months_ahead int)
returns date
language sql
immutable
as $$
  select make_date(
    extract(year from t)::int,
    extract(month from t)::int,
    least(anchor_day, extract(day from public.month_end(t))::int)
  )
  from (select (anchor + make_interval(months => months_ahead))::date as t) s;
$$;

-- ============================================================================
-- TABLES
-- ============================================================================
-- Every table carries `user_id default public.app_scope_user_id()` so rows are automatically
-- scoped to the signed-in user and RLS never needs the client to pass an id.

create table if not exists public.customers (
  id              text primary key,
  user_id         uuid not null default public.app_scope_user_id(),
  code            text not null default '',
  name            text not null default '',
  mobile          text not null default '',
  email           text not null default '',
  guardian_name   text not null default '',
  guardian_phone  text not null default '',
  address         text not null default '',
  occupation      text not null default '',
  proof_type      text not null default 'AADHAAR',
  proof_id        text not null default '',
  joining_date    date not null,
  sharing_type    int  not null default 1,
  rent_amount     numeric(12,2) not null default 0,
  deposit_amount  numeric(12,2) not null default 0,
  deposit_paid    boolean not null default false,
  room_no         text not null default '',
  bed_no          text not null default '',
  notes           text not null default '',
  due_day         int  not null default 1,
  next_due_date   date not null,
  advance_credit  numeric(12,2) not null default 0,
  terms_accepted  boolean not null default false,
  terms_accepted_at timestamptz,
  status          text not null default 'active',
  photo_id        text,
  proof_image_id  text,
  -- Legacy pre-ledger payments array, kept for migration/import fidelity.
  payments        jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists customers_user_idx on public.customers (user_id);

create table if not exists public.rent_cycles (
  id            text primary key,
  user_id       uuid not null default public.app_scope_user_id(),
  customer_id   text not null references public.customers (id) on delete cascade,
  due_date      date not null,
  rent_amount   numeric(12,2) not null default 0,
  paid_amount   numeric(12,2) not null default 0,
  settled_at    timestamptz,
  migrated_from text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists rent_cycles_customer_idx on public.rent_cycles (customer_id);
create index if not exists rent_cycles_due_idx on public.rent_cycles (due_date);
create index if not exists rent_cycles_user_idx on public.rent_cycles (user_id);

create table if not exists public.light_bills (
  id            text primary key,
  user_id       uuid not null default public.app_scope_user_id(),
  customer_id   text not null references public.customers (id) on delete cascade,
  month         text not null,                 -- 'YYYY-MM'
  units         numeric(12,2),
  rate_per_unit numeric(12,2),
  bill_amount   numeric(12,2) not null default 0,
  paid_amount   numeric(12,2) not null default 0,
  note          text not null default '',
  migrated_from text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists light_bills_customer_month_idx
  on public.light_bills (customer_id, month);
create index if not exists light_bills_customer_idx on public.light_bills (customer_id);
create index if not exists light_bills_user_idx on public.light_bills (user_id);

create table if not exists public.transactions (
  id               text primary key,
  user_id          uuid not null default public.app_scope_user_id(),
  customer_id      text not null references public.customers (id) on delete cascade,
  customer_name    text not null default '',
  type             text not null check (type in ('RENT', 'LIGHT_BILL')),
  cycle_id         text references public.rent_cycles (id) on delete set null,
  bill_id          text references public.light_bills (id) on delete set null,
  amount           numeric(12,2) not null default 0,
  date             date not null,
  mode             text not null default 'cash',
  note             text not null default '',
  -- Reversal metadata: everything a delete needs to undo the payment exactly.
  opened_cycle_id  text,
  credit_before    numeric(12,2),
  credit_after     numeric(12,2),
  settled_at       timestamptz,
  due_date_before  date,
  due_date_after   date,
  bill_month       text,
  migrated_from    text,
  created_at       timestamptz not null default now()
);

create index if not exists transactions_customer_idx on public.transactions (customer_id);
create index if not exists transactions_date_idx on public.transactions (date);
create index if not exists transactions_user_idx on public.transactions (user_id);

-- One row per account, keyed by the owner's own id. The row is *not* seeded
-- here: at migration time there is no signed-in user, so `auth.uid()` is null,
-- and a fixed sentinel key would give every account in the project the same
-- row. Instead the app inserts its own row on first save.
create table if not exists public.settings (
  user_id               uuid primary key default public.app_scope_user_id(),
  sharing_prices        jsonb not null default '{}'::jsonb,
  default_deposit       numeric(12,2) not null default 0,
  rent_due_day_of_month int not null default 10,
  terms                 text not null default '',
  pg_name               text not null default 'Sunrise Paying Guest',
  owner_name            text not null default 'PG Manager',
  owner_mobile          text not null default '',
  currency_note         text not null default '',
  updated_at            timestamptz not null default now()
);

-- ============================================================================
-- COMPUTED VIEWS
-- remaining = amount - paid_amount is derived, never stored. The app reads
-- these views; the tables hold only the two source-of-truth numbers.
-- ============================================================================
create or replace view public.rent_cycles_view as
select
  rc.*,
  (rc.rent_amount - rc.paid_amount)::numeric(12,2) as remaining_amount,
  case
    when rc.rent_amount - rc.paid_amount <= 0 then 'paid'
    when rc.paid_amount > 0 then 'partial'
    else 'pending'
  end as status
from public.rent_cycles rc;

create or replace view public.light_bills_view as
select
  lb.*,
  (lb.bill_amount - lb.paid_amount)::numeric(12,2) as remaining_amount,
  case
    when lb.bill_amount - lb.paid_amount <= 0 then 'paid'
    when lb.paid_amount > 0 then 'partial'
    else 'pending'
  end as status
from public.light_bills lb;

-- ============================================================================
-- ROW LEVEL SECURITY
-- Every table is scoped to the row owner. RPCs are SECURITY DEFINER (they have
-- to be, to write several tables atomically) so each one re-guards every query
-- with `user_id = public.app_scope_user_id()` internally.
-- ============================================================================
alter table public.customers enable row level security;
alter table public.rent_cycles enable row level security;
alter table public.light_bills enable row level security;
alter table public.transactions enable row level security;
alter table public.settings enable row level security;

drop policy if exists "own customers" on public.customers;
create policy "own customers" on public.customers
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own cycles" on public.rent_cycles;
create policy "own cycles" on public.rent_cycles
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own light bills" on public.light_bills;
create policy "own light bills" on public.light_bills
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());

-- ============================================================================
-- PRIVATE STORAGE (identity documents)
-- Paths are `{auth.uid()}/c/{customerId}/photo|proof/{imageId}.jpg`; the app
-- reads them back through short-lived signed URLs only.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('identity-docs', 'identity-docs', false)
on conflict (id) do nothing;

drop policy if exists "identity-docs owner all" on storage.objects;
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

-- ============================================================================
-- JSON SHAPERS
-- The UI speaks camelCase; these translate DB rows to the exact JSON shapes
-- the client services expect, so the RPCs can return ready-to-use objects.
-- ============================================================================
create or replace function public.cycle_json(rc public.rent_cycles)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', rc.id,
    'customerId', rc.customer_id,
    'dueDate', rc.due_date,
    'rentAmount', rc.rent_amount::numeric,
    'paidAmount', rc.paid_amount::numeric,
    'remainingAmount', (rc.rent_amount - rc.paid_amount)::numeric,
    'status', case when rc.rent_amount - rc.paid_amount <= 0 then 'paid'
                   when rc.paid_amount > 0 then 'partial' else 'pending' end,
    'settledAt', rc.settled_at,
    'createdAt', rc.created_at,
    'updatedAt', rc.updated_at
  );
$$;

create or replace function public.cycle_json(rc public.rent_cycles_view)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', rc.id,
    'customerId', rc.customer_id,
    'dueDate', rc.due_date,
    'rentAmount', rc.rent_amount::numeric,
    'paidAmount', rc.paid_amount::numeric,
    'remainingAmount', rc.remaining_amount::numeric,
    'status', rc.status,
    'settledAt', rc.settled_at,
    'createdAt', rc.created_at,
    'updatedAt', rc.updated_at
  );
$$;

create or replace function public.bill_json(lb public.light_bills)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', lb.id,
    'customerId', lb.customer_id,
    'month', lb.month,
    'units', lb.units,
    'ratePerUnit', lb.rate_per_unit,
    'billAmount', lb.bill_amount::numeric,
    'paidAmount', lb.paid_amount::numeric,
    'remainingAmount', (lb.bill_amount - lb.paid_amount)::numeric,
    'status', case when lb.bill_amount - lb.paid_amount <= 0 then 'paid'
                   when lb.paid_amount > 0 then 'partial' else 'pending' end,
    'note', lb.note,
    'createdAt', lb.created_at,
    'updatedAt', lb.updated_at
  );
$$;

create or replace function public.bill_json(lb public.light_bills_view)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', lb.id,
    'customerId', lb.customer_id,
    'month', lb.month,
    'units', lb.units,
    'ratePerUnit', lb.rate_per_unit,
    'billAmount', lb.bill_amount::numeric,
    'paidAmount', lb.paid_amount::numeric,
    'remainingAmount', lb.remaining_amount::numeric,
    'status', lb.status,
    'note', lb.note,
    'createdAt', lb.created_at,
    'updatedAt', lb.updated_at
  );
$$;

create or replace function public.transaction_json(
  p_id text,
  p_customer_id text,
  p_customer_name text,
  p_type text,
  p_cycle_id text,
  p_bill_id text,
  p_amount numeric,
  p_date date,
  p_mode text,
  p_note text,
  p_created_at timestamptz,
  p_opened_cycle_id text,
  p_credit_before numeric,
  p_credit_after numeric,
  p_settled_at timestamptz,
  p_due_date_before date,
  p_due_date_after date,
  p_bill_month text
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', p_id,
    'customerId', p_customer_id,
    'customerName', p_customer_name,
    'type', p_type,
    'cycleId', p_cycle_id,
    'billId', p_bill_id,
    'amount', p_amount,
    'date', p_date,
    'mode', p_mode,
    'note', p_note,
    'createdAt', p_created_at,
    'openedCycleId', p_opened_cycle_id,
    'creditBefore', p_credit_before,
    'creditAfter', p_credit_after,
    'settledAt', p_settled_at,
    'dueDateBefore', p_due_date_before,
    'dueDateAfter', p_due_date_after,
    'billMonth', p_bill_month
  );
$$;

create or replace function public.transaction_json(t public.transactions)
returns jsonb
language sql
stable
as $$
  select public.transaction_json(
    t.id, t.customer_id, t.customer_name, t.type, t.cycle_id, t.bill_id,
    t.amount::numeric, t.date, t.mode, t.note, t.created_at,
    t.opened_cycle_id, t.credit_before, t.credit_after, t.settled_at,
    t.due_date_before, t.due_date_after, t.bill_month
  );
$$;

-- ============================================================================
-- PAYMENT PLAN (pure: previews and records share exactly the same maths)
-- Mirrors src/utils/ledger.js -> planRentPayment, so the storefront preview
-- and the stored result can never disagree.
--   amount < remaining -> partial, due date stays put
--   amount = remaining -> settled, next cycle opens one month later
--   amount > remaining -> settled, surplus rolls into the next cycle as
--                         advance, anything left over is held as credit
-- ============================================================================
create or replace function public.plan_rent_payment(
  p_cycle jsonb,
  p_amount numeric,
  p_due_day int,
  p_next_rent numeric,
  p_advance_credit numeric
)
returns jsonb
language plpgsql
as $$
declare
  v_total            numeric;
  v_paid_before      numeric;
  v_remaining_before numeric;
  v_requested        numeric;
  v_applied          numeric;
  v_surplus          numeric;
  v_paid_after       numeric;
  v_remaining_after  numeric;
  v_kind             text;
  v_settled          boolean;
  v_status           text;
  v_due_day          int := coalesce(p_due_day, extract(day from (p_cycle->>'dueDate')::date)::int);
  v_rent             numeric := greatest(coalesce(p_next_rent, (p_cycle->>'rentAmount')::numeric), 0);
  v_credit           numeric := greatest(coalesce(p_advance_credit, 0), 0);
  v_pool             numeric;
  v_applied_next     numeric;
  v_remaining_next   numeric;
  v_next_due         date;
  v_next_cycle       jsonb;
begin
  v_total := greatest(coalesce((p_cycle->>'rentAmount')::numeric, 0), 0);
  v_paid_before := greatest(coalesce((p_cycle->>'paidAmount')::numeric, 0), 0);
  v_remaining_before := greatest(v_total - v_paid_before, 0);
  v_requested := greatest(coalesce(p_amount, 0), 0);

  if v_requested <= 0 then
    return jsonb_build_object(
      'kind', 'none', 'requested', 0, 'applied', 0, 'surplus', 0,
      'paidBefore', v_paid_before, 'paidAfter', v_paid_before,
      'remainingBefore', v_remaining_before, 'remainingAfter', v_remaining_before,
      'settled', v_remaining_before <= 0,
      'status', case when v_remaining_before <= 0 then 'paid'
                     when v_paid_before > 0 then 'partial' else 'pending' end,
      'dueDay', v_due_day, 'nextRentAmount', v_rent, 'previousCredit', v_credit,
      'nextCycle', null, 'creditAfter', v_credit, 'carriedToNextCycle', 0
    );
  end if;

  v_applied := least(v_requested, v_remaining_before);
  v_surplus := greatest(v_requested - v_applied, 0);
  v_paid_after := round(v_paid_before + v_applied, 2);
  v_remaining_after := greatest(v_remaining_before - v_applied, 0);

  if v_remaining_before <= 0 then
    v_kind := 'excess';
  elsif v_surplus > 0 then
    v_kind := 'over';
  elsif v_remaining_after <= 0 then
    v_kind := 'exact';
  else
    v_kind := 'partial';
  end if;

  v_settled := v_remaining_after <= 0;
  v_status := case when v_remaining_after <= 0 then 'paid'
                   when v_applied > 0 then 'partial' else 'pending' end;

  if not v_settled then
    return jsonb_build_object(
      'kind', v_kind, 'requested', v_requested, 'applied', v_applied, 'surplus', v_surplus,
      'paidBefore', v_paid_before, 'paidAfter', v_paid_after,
      'remainingBefore', v_remaining_before, 'remainingAfter', v_remaining_after,
      'settled', v_settled, 'status', v_status,
      'dueDay', v_due_day, 'nextRentAmount', v_rent, 'previousCredit', v_credit,
      'nextCycle', null, 'creditAfter', v_credit, 'carriedToNextCycle', 0
    );
  end if;

  v_next_due := public.advance_due_date((p_cycle->>'dueDate')::date, v_due_day, 1);
  v_pool := round(v_surplus + v_credit, 2);
  v_applied_next := round(least(v_pool, v_rent), 2);
  v_remaining_next := round(greatest(v_rent - v_applied_next, 0), 2);
  v_next_cycle := jsonb_build_object(
    'dueDate', v_next_due,
    'rentAmount', v_rent,
    'paidAmount', v_applied_next,
    'remainingAmount', v_remaining_next,
    'status', case when v_remaining_next <= 0 then 'paid'
                   when v_applied_next > 0 then 'partial' else 'pending' end
  );

  return jsonb_build_object(
    'kind', v_kind, 'requested', v_requested, 'applied', v_applied, 'surplus', v_surplus,
    'paidBefore', v_paid_before, 'paidAfter', v_paid_after,
    'remainingBefore', v_remaining_before, 'remainingAfter', v_remaining_after,
    'settled', v_settled, 'status', v_status,
    'dueDay', v_due_day, 'nextRentAmount', v_rent, 'previousCredit', v_credit,
    'nextCycle', v_next_cycle, 'creditAfter', round(greatest(v_pool - v_applied_next, 0), 2),
    'carriedToNextCycle', v_applied_next
  );
end;
$$;

-- ============================================================================
-- RPC: record_rent_payment
-- Atomically: update the open cycle, open the next one if settled, insert the
-- transaction and move the customer's due date / advance credit. Raises the
-- same user-facing errors the client services used to raise.
-- ============================================================================
create or replace function public.record_rent_payment(
  p_customer_id text,
  p_amount numeric,
  p_date date default current_date,
  p_mode text default 'cash',
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user      uuid := public.app_scope_user_id();
  v_customer  public.customers%rowtype;
  v_cycle     public.rent_cycles%rowtype;
  v_plan      jsonb;
  v_tx_id     text;
  v_tx        public.transactions%rowtype;
  v_opened_id text := null;
  v_next_json jsonb := null;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  select * into v_customer
  from public.customers c
  where c.id = p_customer_id and c.user_id = v_user;
  if not found then
    raise exception 'Customer not found.';
  end if;

  select * into v_cycle
  from public.rent_cycles rc
  where rc.customer_id = p_customer_id and rc.user_id = v_user
    and rc.rent_amount - rc.paid_amount > 0
  order by rc.due_date desc, rc.created_at desc, rc.id
  limit 1;
  if not found then
    select * into v_cycle
    from public.rent_cycles rc
    where rc.customer_id = p_customer_id and rc.user_id = v_user
    order by rc.due_date desc, rc.created_at desc, rc.id
    limit 1;
  end if;
  if not found then
    raise exception 'No open rent cycle for this tenant.';
  end if;

  v_plan := public.plan_rent_payment(
    jsonb_build_object(
      'rentAmount', v_cycle.rent_amount,
      'paidAmount', v_cycle.paid_amount,
      'dueDate', v_cycle.due_date
    ),
    p_amount, v_customer.due_day, v_customer.rent_amount, v_customer.advance_credit
  );

  if (v_plan->>'applied')::numeric <= 0 and (v_plan->>'surplus')::numeric <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;

  update public.rent_cycles
  set paid_amount = round((v_plan->>'paidAfter')::numeric, 2),
      settled_at  = case when (v_plan->>'settled')::boolean then now() else null end,
      updated_at  = now()
  where id = v_cycle.id;

  if (v_plan->>'settled')::boolean then
    v_opened_id := public.app_id('cyc_');
    insert into public.rent_cycles
      (id, user_id, customer_id, due_date, rent_amount, paid_amount, created_at, updated_at)
    values (
      v_opened_id, v_user, p_customer_id,
      (v_plan->'nextCycle'->>'dueDate')::date,
      round((v_plan->'nextCycle'->>'rentAmount')::numeric, 2),
      round((v_plan->'nextCycle'->>'paidAmount')::numeric, 2),
      now(), now()
    );
    v_next_json := jsonb_build_object(
      'id', v_opened_id,
      'customerId', p_customer_id,
      'dueDate', (v_plan->'nextCycle'->>'dueDate')::date,
      'rentAmount', round((v_plan->'nextCycle'->>'rentAmount')::numeric, 2),
      'paidAmount', round((v_plan->'nextCycle'->>'paidAmount')::numeric, 2),
      'remainingAmount', round((v_plan->'nextCycle'->>'remainingAmount')::numeric, 2),
      'status', (v_plan->'nextCycle'->>'status'),
      'settledAt', null
    );
  end if;

  v_tx_id := public.app_id('txn_');
  insert into public.transactions
    (id, user_id, customer_id, customer_name, type, cycle_id, bill_id, amount, date, mode, note,
     opened_cycle_id, credit_before, credit_after, settled_at, due_date_before, due_date_after,
     bill_month, created_at)
  values (
    v_tx_id, v_user, p_customer_id, v_customer.name, 'RENT', v_cycle.id, null,
    round(p_amount, 2), p_date, p_mode, p_note,
    v_opened_id,
    (v_plan->>'previousCredit')::numeric,
    (v_plan->>'creditAfter')::numeric,
    case when (v_plan->>'settled')::boolean then now() else null end,
    v_cycle.due_date,
    case when (v_plan->>'settled')::boolean
         then (v_plan->'nextCycle'->>'dueDate')::date else v_cycle.due_date end,
    null, now()
  ) returning * into v_tx;

  update public.customers
  set advance_credit = round((v_plan->>'creditAfter')::numeric, 2),
      next_due_date  = case when (v_plan->>'settled')::boolean
                            then (v_plan->'nextCycle'->>'dueDate')::date else v_cycle.due_date end,
      updated_at     = now()
  where id = p_customer_id;

  select * into v_cycle from public.rent_cycles where id = v_cycle.id;

  return jsonb_build_object(
    'transaction', public.transaction_json(v_tx),
    'cycle', public.cycle_json(v_cycle),
    'nextCycle', v_next_json,
    'plan', v_plan
  );
end;
$$;

-- ============================================================================
-- RPC: preview_rent_payment (pure - writes nothing)
-- ============================================================================
create or replace function public.preview_rent_payment(
  p_customer_id text,
  p_amount numeric,
  p_next_rent numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user     uuid := public.app_scope_user_id();
  v_customer public.customers%rowtype;
  v_cycle    public.rent_cycles%rowtype;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  select * into v_customer
  from public.customers c
  where c.id = p_customer_id and c.user_id = v_user;
  if not found then
    raise exception 'Customer not found.';
  end if;

  select * into v_cycle
  from public.rent_cycles rc
  where rc.customer_id = p_customer_id and rc.user_id = v_user
    and rc.rent_amount - rc.paid_amount > 0
  order by rc.due_date desc, rc.created_at desc, rc.id
  limit 1;
  if not found then
    select * into v_cycle
    from public.rent_cycles rc
    where rc.customer_id = p_customer_id and rc.user_id = v_user
    order by rc.due_date desc, rc.created_at desc, rc.id
    limit 1;
  end if;
  if not found then
    raise exception 'No open rent cycle for this tenant.';
  end if;

  return public.plan_rent_payment(
    jsonb_build_object(
      'rentAmount', v_cycle.rent_amount,
      'paidAmount', v_cycle.paid_amount,
      'dueDate', v_cycle.due_date
    ),
    p_amount, v_customer.due_day, coalesce(p_next_rent, v_customer.rent_amount), v_customer.advance_credit
  );
end;
$$;

-- ============================================================================
-- RPC: save_light_bill (create or update one bill per tenant per month)
-- ============================================================================
create or replace function public.save_light_bill(
  p_customer_id text,
  p_bill_id text default null,
  p_month text default null,
  p_units numeric default null,
  p_rate_per_unit numeric default null,
  p_bill_amount numeric default null,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user     uuid := public.app_scope_user_id();
  v_month    text := coalesce(p_month, to_char(current_date, 'YYYY-MM'));
  v_computed numeric;
  v_row      public.light_bills%rowtype;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.user_id = v_user
  ) then
    raise exception 'Customer not found.';
  end if;

  v_computed := coalesce(p_bill_amount, p_units * p_rate_per_unit);
  v_computed := round(greatest(coalesce(v_computed, 0), 0), 2);
  if v_computed <= 0 then
    raise exception 'Enter a bill amount greater than zero.';
  end if;

  select * into v_row
  from public.light_bills lb
  where lb.customer_id = p_customer_id and lb.user_id = v_user
    and (lb.id = p_bill_id or (p_bill_id is null and lb.month = v_month))
  limit 1;

  if found then
    if v_row.paid_amount > v_computed then
      raise exception 'The bill amount cannot be less than the amount already paid.';
    end if;
    update public.light_bills
    set month = v_month, units = p_units, rate_per_unit = p_rate_per_unit,
        bill_amount = v_computed, note = p_note, updated_at = now()
    where id = v_row.id;
    select * into v_row from public.light_bills where id = v_row.id;
  else
    insert into public.light_bills
      (id, user_id, customer_id, month, units, rate_per_unit, bill_amount, paid_amount, note, created_at, updated_at)
    values (
      public.app_id('bil_'), v_user, p_customer_id, v_month, p_units, p_rate_per_unit,
      v_computed, 0, p_note, now(), now()
    ) returning * into v_row;
  end if;

  return public.bill_json(v_row);
end;
$$;

-- ============================================================================
-- RPC: record_light_bill_payment (atomically update the bill + insert tx)
-- ============================================================================
create or replace function public.record_light_bill_payment(
  p_customer_id text,
  p_bill_id text,
  p_amount numeric,
  p_date date default current_date,
  p_mode text default 'cash',
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user            uuid := public.app_scope_user_id();
  v_customer_name   text;
  v_bill            public.light_bills%rowtype;
  v_total           numeric;
  v_paid_before     numeric;
  v_remaining_before numeric;
  v_requested       numeric;
  v_applied         numeric;
  v_surplus         numeric;
  v_paid_after      numeric;
  v_remaining_after numeric;
  v_kind            text;
  v_settled         boolean;
  v_status          text;
  v_tx              public.transactions%rowtype;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  select name into v_customer_name
  from public.customers c
  where c.id = p_customer_id and c.user_id = v_user;
  if not found then
    raise exception 'Customer not found.';
  end if;

  select * into v_bill
  from public.light_bills lb
  where lb.id = p_bill_id and lb.user_id = v_user;
  if not found then
    raise exception 'Light bill not found.';
  end if;

  v_total := greatest(v_bill.bill_amount, 0);
  v_paid_before := greatest(v_bill.paid_amount, 0);
  v_remaining_before := greatest(v_total - v_paid_before, 0);
  v_requested := greatest(coalesce(p_amount, 0), 0);

  if v_requested <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;

  v_applied := least(v_requested, v_remaining_before);
  v_surplus := greatest(v_requested - v_applied, 0);
  v_paid_after := round(v_paid_before + v_applied, 2);
  v_remaining_after := greatest(v_remaining_before - v_applied, 0);

  if v_remaining_before <= 0 then v_kind := 'excess';
  elsif v_surplus > 0 then v_kind := 'over';
  elsif v_remaining_after <= 0 then v_kind := 'exact';
  else v_kind := 'partial'; end if;

  v_settled := v_remaining_after <= 0;
  v_status := case when v_remaining_after <= 0 then 'paid'
                   when v_applied > 0 then 'partial' else 'pending' end;

  update public.light_bills
  set paid_amount = v_paid_after, updated_at = now()
  where id = p_bill_id;

  insert into public.transactions
    (id, user_id, customer_id, customer_name, type, bill_id, amount, date, mode, note,
     bill_month, created_at)
  values (
    public.app_id('txn_'), v_user, p_customer_id, v_customer_name, 'LIGHT_BILL', p_bill_id,
    round(p_amount, 2), p_date, p_mode, p_note, v_bill.month, now()
  ) returning * into v_tx;

  select * into v_bill from public.light_bills where id = p_bill_id;

  return jsonb_build_object(
    'transaction', public.transaction_json(v_tx),
    'bill', public.bill_json(v_bill),
    'result', jsonb_build_object(
      'kind', v_kind, 'requested', v_requested, 'applied', v_applied, 'surplus', v_surplus,
      'paidBefore', v_paid_before, 'paidAfter', v_paid_after,
      'remainingBefore', v_remaining_before, 'remainingAfter', v_remaining_after,
      'settled', v_settled, 'status', v_status
    )
  );
end;
$$;

-- ============================================================================
-- RPC: delete_transaction
-- Deletes the transaction and restores every balance it changed: the linked
-- cycle/bill is rebuilt from the transactions that remain, the cycle this
-- payment opened is removed if nothing was ever paid into it, and the
-- customer's advance credit / next due date return to their pre-payment values.
-- ============================================================================
create or replace function public.delete_transaction(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user     uuid := public.app_scope_user_id();
  v_tx       public.transactions%rowtype;
  v_sum      numeric;
  v_used     boolean;
  v_open     public.rent_cycles%rowtype;
  v_next     date;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  select * into v_tx
  from public.transactions t
  where t.id = p_id and t.user_id = v_user;
  if not found then
    raise exception 'Transaction not found.';
  end if;

  delete from public.transactions where id = p_id;

  if v_tx.type = 'LIGHT_BILL' then
    select coalesce(sum(t.amount), 0) into v_sum
    from public.transactions t
    where t.bill_id = v_tx.bill_id and t.user_id = v_user;
    update public.light_bills
    set paid_amount = round(v_sum, 2), updated_at = now()
    where id = v_tx.bill_id;
    return jsonb_build_object('transaction', public.transaction_json(v_tx));
  end if;

  select coalesce(sum(t.amount), 0) into v_sum
  from public.transactions t
  where t.cycle_id = v_tx.cycle_id and t.user_id = v_user;
  update public.rent_cycles
  set paid_amount = round(v_sum, 2),
      settled_at = case
        when round(v_sum, 2) >= (select rent_amount from public.rent_cycles where id = v_tx.cycle_id)
        then coalesce((select settled_at from public.rent_cycles where id = v_tx.cycle_id), now())
        else null end,
      updated_at = now()
  where id = v_tx.cycle_id;

  if v_tx.opened_cycle_id is not null then
    select exists(
      select 1 from public.transactions t
      where t.cycle_id = v_tx.opened_cycle_id and t.user_id = v_user
    ) into v_used;
    if not v_used then
      delete from public.rent_cycles where id = v_tx.opened_cycle_id and user_id = v_user;
    end if;
  end if;

  v_next := v_tx.due_date_before;
  select * into v_open
  from public.rent_cycles rc
  where rc.customer_id = v_tx.customer_id and rc.user_id = v_user
    and rc.rent_amount - rc.paid_amount > 0
  order by rc.due_date desc, rc.created_at desc, rc.id
  limit 1;
  if not found then
    select * into v_open
    from public.rent_cycles rc
    where rc.customer_id = v_tx.customer_id and rc.user_id = v_user
    order by rc.due_date desc, rc.created_at desc, rc.id
    limit 1;
  end if;
  if found then
    v_next := v_open.due_date;
  end if;

  update public.customers
  set advance_credit = coalesce(v_tx.credit_before, 0),
      next_due_date  = v_next,
      updated_at     = now()
  where id = v_tx.customer_id;

  return jsonb_build_object(
    'transaction', public.transaction_json(v_tx),
    'cycle', case when found then public.cycle_json(v_open) else null end
  );
end;
$$;

-- ============================================================================
-- RPC: import_backup
-- One-shots a full localStorage export into this account, preserving every
-- client id so no cross-reference is lost. Idempotent per id.
-- ============================================================================
create or replace function public.import_backup(
  p_customers jsonb default '[]'::jsonb,
  p_cycles jsonb default '[]'::jsonb,
  p_bills jsonb default '[]'::jsonb,
  p_transactions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := public.app_scope_user_id();
  rec     jsonb;
  v_c int := 0;
  v_cy int := 0;
  v_b  int := 0;
  v_t  int := 0;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  for rec in select value from jsonb_array_elements(coalesce(p_customers, '[]'::jsonb)) loop
    insert into public.customers (
      id, user_id, code, name, mobile, email, guardian_name, guardian_phone,
      address, occupation, proof_type, proof_id, joining_date, sharing_type,
      rent_amount, deposit_amount, deposit_paid, room_no, bed_no, notes,
      due_day, next_due_date, advance_credit, terms_accepted, terms_accepted_at,
      status, photo_id, proof_image_id, payments, created_at, updated_at
    ) values (
      rec->>'id', v_user,
      coalesce(rec->>'code', ''),
      coalesce(rec->>'name', ''),
      coalesce(rec->>'mobile', ''),
      coalesce(rec->>'email', ''),
      coalesce(rec->>'guardianName', ''),
      coalesce(rec->>'guardianPhone', ''),
      coalesce(rec->>'address', ''),
      coalesce(rec->>'occupation', ''),
      coalesce(rec->>'proofType', 'AADHAAR'),
      coalesce(rec->>'proofId', ''),
      coalesce((rec->>'joiningDate')::date, current_date),
      coalesce((rec->>'sharingType')::int, 1),
      coalesce((rec->>'rentAmount')::numeric, 0),
      coalesce((rec->>'depositAmount')::numeric, 0),
      coalesce((rec->>'depositPaid')::boolean, false),
      coalesce(rec->>'roomNo', ''),
      coalesce(rec->>'bedNo', ''),
      coalesce(rec->>'notes', ''),
      coalesce((rec->>'dueDay')::int, extract(day from current_date)::int),
      coalesce((rec->>'nextDueDate')::date, current_date),
      coalesce((rec->>'advanceCredit')::numeric, 0),
      coalesce((rec->>'termsAccepted')::boolean, false),
      (rec->>'termsAcceptedAt')::timestamptz,
      coalesce(rec->>'status', 'active'),
      rec->>'photoId',
      rec->>'proofImageId',
      coalesce(rec->'payments', '[]'::jsonb),
      coalesce((rec->>'createdAt')::timestamptz, now()),
      coalesce((rec->>'updatedAt')::timestamptz, now())
    )
    on conflict (id) do nothing;
    v_c := v_c + 1;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_cycles, '[]'::jsonb)) loop
    insert into public.rent_cycles (
      id, user_id, customer_id, due_date, rent_amount, paid_amount, settled_at,
      migrated_from, created_at, updated_at
    ) values (
      rec->>'id', v_user, rec->>'customerId',
      coalesce((rec->>'dueDate')::date, current_date),
      coalesce((rec->>'rentAmount')::numeric, 0),
      coalesce((rec->>'paidAmount')::numeric, 0),
      (rec->>'settledAt')::timestamptz,
      rec->>'migratedFrom',
      coalesce((rec->>'createdAt')::timestamptz, now()),
      coalesce((rec->>'updatedAt')::timestamptz, now())
    )
    on conflict (id) do nothing;
    v_cy := v_cy + 1;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_bills, '[]'::jsonb)) loop
    insert into public.light_bills (
      id, user_id, customer_id, month, units, rate_per_unit, bill_amount, paid_amount,
      note, migrated_from, created_at, updated_at
    ) values (
      rec->>'id', v_user, rec->>'customerId',
      coalesce(rec->>'month', to_char(current_date, 'YYYY-MM')),
      (rec->>'units')::numeric,
      (rec->>'ratePerUnit')::numeric,
      coalesce((rec->>'billAmount')::numeric, 0),
      coalesce((rec->>'paidAmount')::numeric, 0),
      coalesce(rec->>'note', ''),
      rec->>'migratedFrom',
      coalesce((rec->>'createdAt')::timestamptz, now()),
      coalesce((rec->>'updatedAt')::timestamptz, now())
    )
    on conflict (id) do nothing;
    v_b := v_b + 1;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_transactions, '[]'::jsonb)) loop
    insert into public.transactions (
      id, user_id, customer_id, customer_name, type, cycle_id, bill_id, amount, date,
      mode, note, opened_cycle_id, credit_before, credit_after, settled_at,
      due_date_before, due_date_after, bill_month, migrated_from, created_at
    ) values (
      rec->>'id', v_user,
      rec->>'customerId',
      coalesce(rec->>'customerName', ''),
      coalesce(rec->>'type', 'RENT'),
      rec->>'cycleId', rec->>'billId',
      coalesce((rec->>'amount')::numeric, 0),
      coalesce((rec->>'date')::date, current_date),
      coalesce(rec->>'mode', 'cash'),
      coalesce(rec->>'note', ''),
      rec->>'openedCycleId',
      (rec->>'creditBefore')::numeric,
      (rec->>'creditAfter')::numeric,
      (rec->>'settledAt')::timestamptz,
      (rec->>'dueDateBefore')::date,
      (rec->>'dueDateAfter')::date,
      rec->>'billMonth',
      rec->>'migratedFrom',
      coalesce((rec->>'createdAt')::timestamptz, now())
    )
    on conflict (id) do nothing;
    v_t := v_t + 1;
  end loop;

  return jsonb_build_object(
    'customers', v_c, 'cycles', v_cy, 'lightBills', v_b, 'transactions', v_t
  );
end;
$$;

-- ============================================================================
-- RPC: wipe_all - remove every owned row (Settings -> Erase all tenant data)
-- ============================================================================
create or replace function public.wipe_all()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := public.app_scope_user_id();
  v_c int := 0;
  v_cy int := 0;
  v_b  int := 0;
  v_t  int := 0;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;
  select count(*) into v_t from public.transactions where user_id = v_user;
  delete from public.transactions where user_id = v_user;
  select count(*) into v_b from public.light_bills where user_id = v_user;
  delete from public.light_bills where user_id = v_user;
  select count(*) into v_cy from public.rent_cycles where user_id = v_user;
  delete from public.rent_cycles where user_id = v_user;
  select count(*) into v_c from public.customers where user_id = v_user;
  delete from public.customers where user_id = v_user;
  return jsonb_build_object('customers', v_c, 'cycles', v_cy, 'lightBills', v_b, 'transactions', v_t);
end;
$$;

-- ############################################################################
-- # SECTION: 002_rooms_and_lifecycle.sql
-- ############################################################################

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

-- room_no is unique per account, not globally: two owners may both have "201".
create unique index if not exists rooms_user_room_no_idx
  on public.rooms (user_id, lower(room_no));
create index if not exists rooms_user_floor_idx on public.rooms (user_id, floor);
create index if not exists rooms_user_sharing_idx on public.rooms (user_id, sharing_type);

-- ============================================================================
-- TENANT LIFECYCLE COLUMNS
-- ============================================================================
alter table public.customers add column if not exists room_id text
  references public.rooms (id) on delete set null;
alter table public.customers add column if not exists vacated_at date;
alter table public.customers add column if not exists notice_given_at date;
alter table public.customers add column if not exists notice_note text;
alter table public.customers add column if not exists expected_leaving_date date;
alter table public.customers add column if not exists damage_charges numeric(12,2) default 0;
alter table public.customers add column if not exists deposit_refund numeric(12,2) default 0;

-- `status` already exists with default 'active'; normalise any legacy values
-- and constrain it going forward. Existing rows keep working.
update public.customers set status = 'active'
  where status is null or status not in ('active', 'notice', 'vacated');
alter table public.customers alter column status set default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customers_status_check'
  ) then
    alter table public.customers
      add constraint customers_status_check
      check (status in ('active', 'notice', 'vacated'));
  end if;
end;
$$;

create index if not exists customers_room_idx on public.customers (room_id);
create index if not exists customers_status_idx on public.customers (user_id, status);
create index if not exists customers_next_due_idx on public.customers (user_id, next_due_date);
create index if not exists customers_leaving_idx
  on public.customers (user_id, expected_leaving_date)
  where expected_leaving_date is not null;

-- ============================================================================
-- ROOM HISTORY - who lived in which room, and when
-- ============================================================================
create table if not exists public.room_history (
  id          text primary key,
  user_id     uuid not null default public.app_scope_user_id(),
  customer_id text not null references public.customers (id) on delete cascade,
  room_id     text references public.rooms (id) on delete set null,
  bed_no      text,
  from_date   date not null,
  to_date     date,
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists room_history_customer_idx
  on public.room_history (user_id, customer_id);
create index if not exists room_history_room_idx on public.room_history (user_id, room_id);

-- ============================================================================
-- EXPENSES - running costs, so the owner can see actual profit
-- ============================================================================
create table if not exists public.expenses (
  id         text primary key,
  user_id    uuid not null default public.app_scope_user_id(),
  category   text not null default 'other'
    check (category in ('electricity', 'water', 'groceries', 'salary', 'repairs', 'internet', 'other')),
  amount     numeric(12,2) not null default 0 check (amount >= 0),
  date       date not null default current_date,
  note       text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists expenses_user_date_idx on public.expenses (user_id, date desc);
create index if not exists expenses_user_cat_idx on public.expenses (user_id, category);

-- ============================================================================
-- AUDIT LOG - who did what, for payments, deletes and room changes
-- ============================================================================
create table if not exists public.audit_log (
  id          text primary key,
  user_id     uuid not null default public.app_scope_user_id(),
  actor_email text not null default '',
  action      text not null,
  entity_type text not null default '',
  entity_id   text,
  summary     text not null default '',
  amount      numeric(12,2),
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_user_created_idx
  on public.audit_log (user_id, created_at desc);

-- ============================================================================
-- TRANSACTIONS: allow REFUND
-- The original check allows only RENT and LIGHT_BILL, so widen it rather than
-- dropping the table. Existing rows are unaffected.
-- ============================================================================
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check
  check (type in ('RENT', 'LIGHT_BILL', 'REFUND'));

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.rooms enable row level security;
alter table public.room_history enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists "own rooms" on public.rooms;
drop policy if exists "own rooms" on public.rooms;
create policy "own rooms" on public.rooms
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());

drop policy if exists "own room history" on public.room_history;
drop policy if exists "own room history" on public.room_history;
create policy "own room history" on public.room_history
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());

drop policy if exists "own expenses" on public.expenses;
drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());

drop policy if exists "own audit log" on public.audit_log;
drop policy if exists "own audit log" on public.audit_log;
create policy "own audit log" on public.audit_log
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());

-- ============================================================================
-- OCCUPANCY VIEW
-- Computed, never stored. Occupancy counts tenants who are `active` or
-- `notice` - someone on notice still holds their bed until they actually leave.
-- ============================================================================
create or replace view public.rooms_occupancy as
select
  r.id,
  r.user_id,
  r.floor,
  r.room_no,
  r.sharing_type,
  r.monthly_rent,
  r.has_ac,
  r.has_attached_bathroom,
  r.notes,
  r.is_active,
  r.created_at,
  r.updated_at,
  r.sharing_type as capacity,
  coalesce(occ.occupied, 0) as occupied,
  greatest(r.sharing_type - coalesce(occ.occupied, 0), 0) as vacant,
  case
    when r.sharing_type - coalesce(occ.occupied, 0) <= 0 then 'full'
    when coalesce(occ.occupied, 0) = 0 then 'empty'
    else 'partial'
  end as occupancy_status
from public.rooms r
left join (
  select
    room_id,
    count(*) as occupied
  from public.customers
  where room_id is not null
    and status in ('active', 'notice')
  group by room_id
) occ on occ.room_id = r.id;

-- ============================================================================
-- JSON SHAPERS
-- ============================================================================
create or replace function public.room_json(r public.rooms)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', r.id,
    'floor', r.floor,
    'roomNo', r.room_no,
    'sharingType', r.sharing_type,
    'monthlyRent', r.monthly_rent,
    'hasAc', r.has_ac,
    'hasAttachedBathroom', r.has_attached_bathroom,
    'notes', r.notes,
    'isActive', r.is_active,
    'createdAt', r.created_at,
    'updatedAt', r.updated_at
  );
$$;

create or replace function public.room_json(r public.rooms_occupancy)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', r.id,
    'floor', r.floor,
    'roomNo', r.room_no,
    'sharingType', r.sharing_type,
    'monthlyRent', r.monthly_rent,
    'hasAc', r.has_ac,
    'hasAttachedBathroom', r.has_attached_bathroom,
    'notes', r.notes,
    'isActive', r.is_active,
    'capacity', r.capacity,
    'occupied', r.occupied,
    'vacant', r.vacant,
    'occupancyStatus', r.occupancy_status,
    'createdAt', r.created_at,
    'updatedAt', r.updated_at
  );
$$;

create or replace function public.expense_json(e public.expenses)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', e.id,
    'category', e.category,
    'amount', e.amount,
    'date', e.date,
    'note', e.note,
    'createdAt', e.created_at
  );
$$;

-- ============================================================================
-- RPC: list_rooms - rooms with computed occupancy and occupant names
-- ============================================================================
create or replace function public.list_rooms()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := public.app_scope_user_id();
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        public.room_json(r) || jsonb_build_object(
          'occupants', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', c.id,
              'name', c.name,
              'bedNo', c.bed_no,
              'status', c.status,
              'code', c.code
            ) order by c.name)
            from public.customers c
            where c.room_id = r.id
              and c.user_id = v_user
              and c.status in ('active', 'notice')
          ), '[]'::jsonb)
        )
      )
      from public.rooms_occupancy r
      where r.user_id = v_user
      order by r.floor, r.room_no
    ),
    '[]'::jsonb
  );
end;
$$;

-- ============================================================================
-- RPC: admit_customer - create a tenant in a bed, with the availability
-- re-checked under a row lock.
--
-- The client's bed picker is only a convenience; two admins (or one admin on two
-- devices) can pick the same free bed at the same moment. Locking the room row
-- serialises admissions for that room, so the second one fails cleanly instead
-- of silently double-booking.
-- ============================================================================
create or replace function public.admit_customer(
  p_customer jsonb,
  p_room_id text,
  p_bed_no text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user    uuid := public.app_scope_user_id();
  v_room    public.rooms%rowtype;
  v_occupied int;
  v_id      text;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  -- Serialise every admission for this room.
  select * into v_room
  from public.rooms
  where id = p_room_id and user_id = v_user
  for update;

  if not found then
    raise exception 'That room no longer exists.';
  end if;

  select count(*) into v_occupied
  from public.customers
  where room_id = p_room_id
    and status in ('active', 'notice');

  if v_occupied >= v_room.sharing_type then
    raise exception 'Room % is now full. Pick another room.', v_room.room_no;
  end if;

  if p_bed_no is not null and p_bed_no <> '' and exists (
    select 1 from public.customers
    where room_id = p_room_id
      and bed_no = p_bed_no
      and status in ('active', 'notice')
  ) then
    raise exception 'Bed % in room % is just taken.', p_bed_no, v_room.room_no;
  end if;

  v_id := coalesce(nullif(p_customer->>'id', ''), 'cus_' || substr(md5(random()::text), 1, 12));

  insert into public.customers (
    id, user_id, code, name, mobile, email, guardian_name, guardian_phone,
    address, occupation, proof_type, proof_id, joining_date, sharing_type,
    rent_amount, deposit_amount, deposit_paid, room_no, bed_no, notes,
    due_day, next_due_date, advance_credit, terms_accepted, terms_accepted_at,
    status, room_id, vacated_at, notice_given_at, notice_note, expected_leaving_date,
    damage_charges, deposit_refund, photo_id, proof_image_id, payments, created_at, updated_at
  )
  values (
    v_id,
    v_user,
    coalesce(p_customer->>'code', ''),
    coalesce(p_customer->>'name', ''),
    coalesce(p_customer->>'mobile', ''),
    coalesce(p_customer->>'email', ''),
    coalesce(p_customer->>'guardianName', ''),
    coalesce(p_customer->>'guardianPhone', ''),
    coalesce(p_customer->>'address', ''),
    coalesce(p_customer->>'occupation', ''),
    coalesce(p_customer->>'proofType', 'AADHAAR'),
    coalesce(p_customer->>'proofId', ''),
    coalesce((p_customer->>'joiningDate')::date, current_date),
    coalesce((p_customer->>'sharingType')::int, v_room.sharing_type),
    -- Room rent wins over the submitted figure; null means "use pricing".
    coalesce(v_room.monthly_rent, (p_customer->>'rentAmount')::numeric, 0),
    coalesce((p_customer->>'depositAmount')::numeric, 0),
    coalesce((p_customer->>'depositPaid')::boolean, false),
    v_room.room_no,
    coalesce(p_bed_no, ''),
    coalesce(p_customer->>'notes', ''),
    coalesce((p_customer->>'dueDay')::int, extract(day from current_date)::int),
    coalesce((p_customer->>'nextDueDate')::date, current_date),
    0,
    coalesce((p_customer->>'termsAccepted')::boolean, false),
    (p_customer->>'termsAcceptedAt')::timestamptz,
    'active',
    p_room_id,
    null,
    null,
    null,
    0,
    0,
    p_customer->>'photoId',
    p_customer->>'proofImageId',
    coalesce(p_customer->'payments', '[]'::jsonb),
    now(),
    now()
  );

  insert into public.room_history (id, user_id, customer_id, room_id, bed_no, from_date, note)
  values (
    'rh_' || substr(md5(random()::text), 1, 12),
    v_user, v_id, p_room_id, coalesce(p_bed_no, ''),
    coalesce((p_customer->>'joiningDate')::date, current_date),
    'Admission'
  );

  return jsonb_build_object(
    'customerId', v_id,
    'roomId', p_room_id,
    'bedNo', coalesce(p_bed_no, ''),
    'occupied', v_occupied + 1,
    'capacity', v_room.sharing_type
  );
end;
$$;

-- ============================================================================
-- RPC: move_customer - change bed, keeping a history row
-- ============================================================================
create or replace function public.move_customer(
  p_customer_id text,
  p_room_id text,
  p_bed_no text default null,
  p_effective_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user    uuid := public.app_scope_user_id();
  v_from    text;
  v_room    public.rooms%rowtype;
  v_occupied int;
  v_on      date := coalesce(p_effective_date, current_date);
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  select room_id into v_from
  from public.customers
  where id = p_customer_id and user_id = v_user
  for update;

  if v_from is null then
    raise exception 'Tenant not found.';
  end if;

  if v_from = p_room_id then
    -- Same room: only the bed can change.
    if exists (
      select 1 from public.customers
      where room_id = p_room_id
        and bed_no = coalesce(p_bed_no, '')
        and status in ('active', 'notice')
        and id <> p_customer_id
    ) then
      raise exception 'Bed % is occupied.', coalesce(p_bed_no, '');
    end if;

    update public.customers
    set bed_no = coalesce(p_bed_no, ''), updated_at = now()
    where id = p_customer_id and user_id = v_user;

    return jsonb_build_object('roomId', p_room_id, 'bedNo', coalesce(p_bed_no, ''));
  end if;

  -- Different room: lock and re-check, exactly like admission.
  select * into v_room
  from public.rooms
  where id = p_room_id and user_id = v_user
  for update;

  if not found then
    raise exception 'That room no longer exists.';
  end if;

  select count(*) into v_occupied
  from public.customers
  where room_id = p_room_id
    and status in ('active', 'notice');

  if v_occupied >= v_room.sharing_type then
    raise exception 'Room % is now full.', v_room.room_no;
  end if;

  if p_bed_no is not null and p_bed_no <> '' and exists (
    select 1 from public.customers
    where room_id = p_room_id
      and bed_no = p_bed_no
      and status in ('active', 'notice')
  ) then
    raise exception 'Bed % in room % is just taken.', p_bed_no, v_room.room_no;
  end if;

  -- Close the current history row and open a new one.
  update public.room_history
  set to_date = v_on
  where user_id = v_user and customer_id = p_customer_id and to_date is null;

  insert into public.room_history (id, user_id, customer_id, room_id, bed_no, from_date, note)
  values (
    'rh_' || substr(md5(random()::text), 1, 12),
    v_user, p_customer_id, p_room_id, coalesce(p_bed_no, ''), v_on, 'Move'
  );

  update public.customers
  set
    room_id = p_room_id,
    room_no = v_room.room_no,
    bed_no = coalesce(p_bed_no, ''),
    sharing_type = v_room.sharing_type,
    updated_at = now()
  where id = p_customer_id and user_id = v_user;

  return jsonb_build_object('roomId', p_room_id, 'bedNo', coalesce(p_bed_no, ''));
end;
$$;

-- ============================================================================
-- RPC: give_notice - mark a tenant as leaving
-- ============================================================================
create or replace function public.give_notice(
  p_customer_id text,
  p_expected_leaving_date date default null,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := public.app_scope_user_id();
  v_leave date := coalesce(p_expected_leaving_date, current_date + 30);
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  if not exists (
    select 1 from public.customers
    where id = p_customer_id and user_id = v_user
  ) then
    raise exception 'Tenant not found.';
  end if;

  update public.customers
  set
    status = 'notice',
    notice_given_at = current_date,
    notice_note = p_note,
    expected_leaving_date = v_leave,
    updated_at = now()
  where id = p_customer_id and user_id = v_user;

  return jsonb_build_object('status', 'notice', 'expectedLeavingDate', v_leave);
end;
$$;

-- ============================================================================
-- RPC: vacate_customer - checkout, refund the deposit, free the bed
--
-- Records the deposit refund as a REFUND transaction so the ledger stays a
-- complete story of money, then marks the tenant vacated and closes their room
-- history. Does not touch rent cycles: outstanding rent stays outstanding and
-- is reported separately in the settlement summary.
-- ============================================================================
create or replace function public.vacate_customer(
  p_customer_id text,
  p_pending_rent numeric default 0,
  p_pending_bill numeric default 0,
  p_damage_charges numeric default 0,
  p_refund_amount numeric default 0,
  p_refund_mode text default 'cash',
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user      uuid := public.app_scope_user_id();
  v_customer  public.customers%rowtype;
  v_tx        text;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id and user_id = v_user
  for update;

  if not found then
    raise exception 'Tenant not found.';
  end if;

  if p_refund_amount > 0 then
    v_tx := 'txn_' || substr(md5(random()::text), 1, 12);

    insert into public.transactions (
      id, user_id, customer_id, customer_name, type, cycle_id, bill_id,
      amount, date, mode, note, created_at
    )
    values (
      v_tx, v_user, p_customer_id, v_customer.name, 'REFUND',
      null, null,
      round(p_refund_amount, 2), current_date, coalesce(nullif(p_refund_mode, ''), 'cash'),
      -- nullif, not coalesce: an empty-string note must fall through to the
      -- generated breakdown, otherwise the audit trail loses the deduction detail.
      coalesce(
        nullif(p_note, ''),
        format(
          'Deposit refund (deducted: rent %s, light %s, damage %s)',
          round(coalesce(p_pending_rent, 0), 2),
          round(coalesce(p_pending_bill, 0), 2),
          round(coalesce(p_damage_charges, 0), 2)
        )
      ),
      now()
    );
  end if;

  update public.room_history
  set to_date = coalesce(to_date, current_date)
  where user_id = v_user and customer_id = p_customer_id and to_date is null;

  update public.customers
  set
    status = 'vacated',
    vacated_at = current_date,
    damage_charges = coalesce(p_damage_charges, 0),
    deposit_refund = coalesce(p_refund_amount, 0),
    updated_at = now()
  where id = p_customer_id and user_id = v_user;

  return jsonb_build_object(
    'customerId', p_customer_id,
    'status', 'vacated',
    'refundTransactionId', case when p_refund_amount > 0 then v_tx else null end,
    'refundAmount', round(coalesce(p_refund_amount, 0), 2)
  );
end;
$$;

-- ============================================================================
-- RPC: delete_room - refuses while anyone still holds a bed
-- ============================================================================
create or replace function public.delete_room(p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user    uuid := public.app_scope_user_id();
  v_room    public.rooms%rowtype;
  v_occupied int;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  select * into v_room
  from public.rooms
  where id = p_room_id and user_id = v_user
  for update;

  if not found then
    raise exception 'Room not found.';
  end if;

  select count(*) into v_occupied
  from public.customers
  where room_id = p_room_id and status in ('active', 'notice');

  if v_occupied > 0 then
    raise exception 'Room % still has % tenant(s). Move or vacate them first.', v_room.room_no, v_occupied;
  end if;

  delete from public.rooms where id = p_room_id and user_id = v_user;

  return jsonb_build_object('deleted', true, 'id', p_room_id);
end;
$$;

-- ============================================================================
-- RPC: dashboard_summary - totals without loading the whole ledger
-- ============================================================================
create or replace function public.dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user      uuid := public.app_scope_user_id();
  v_rooms     int;
  v_capacity  int;
  v_occupied  int;
  v_vacant    int;
  v_full      int;
  v_leaving   int;
  v_expected  numeric;
  v_collected numeric;
  v_expenses  numeric;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  select
    count(*),
    coalesce(sum(r.sharing_type), 0),
    coalesce(sum(r.occupied), 0),
    count(*) filter (where r.occupancy_status = 'full')
  into v_rooms, v_capacity, v_occupied, v_full
  from public.rooms_occupancy r
  where r.user_id = v_user and r.is_active;

  v_vacant := greatest(v_capacity - v_occupied, 0);

  select count(*) into v_leaving
  from public.customers
  where user_id = v_user
    and status = 'notice'
    and expected_leaving_date is not null
    and expected_leaving_date <= current_date + 30;

  select coalesce(sum(rent_amount), 0) into v_expected
  from public.rent_cycles rc
  join public.customers c on c.id = rc.customer_id
  where rc.user_id = v_user
    and rc.settled_at is null
    and c.status in ('active', 'notice');

  select coalesce(sum(amount), 0) into v_collected
  from public.transactions
  where user_id = v_user
    and type = 'RENT'
    and date >= date_trunc('month', current_date)::date;

  select coalesce(sum(amount), 0) into v_expenses
  from public.expenses
  where user_id = v_user
    and date >= date_trunc('month', current_date)::date;

  return jsonb_build_object(
    'totalRooms', v_rooms,
    'totalBeds', v_capacity,
    'occupiedBeds', v_occupied,
    'vacantBeds', v_vacant,
    'fullyOccupiedRooms', v_full,
    'occupancyPercent', case when v_capacity = 0 then 0
      else round((v_occupied::numeric / v_capacity) * 100, 1) end,
    'leavingSoon', v_leaving,
    'expectedRent', round(v_expected, 2),
    'collectedRent', round(v_collected, 2),
    'expensesThisMonth', round(v_expenses, 2)
  );
end;
$$;

-- ============================================================================
-- RPC: upcoming_vacates - tenants on notice, soonest first
-- ============================================================================
create or replace function public.upcoming_vacates(p_days int default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := public.app_scope_user_id();
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'code', c.code,
          'name', c.name,
          'mobile', c.mobile,
          'roomNo', c.room_no,
          'bedNo', c.bed_no,
          'noticeGivenAt', c.notice_given_at,
          'expectedLeavingDate', c.expected_leaving_date,
          'depositAmount', c.deposit_amount
        )
        order by c.expected_leaving_date
      )
      from public.customers c
      where c.user_id = v_user
        and c.status = 'notice'
        and c.expected_leaving_date is not null
        and c.expected_leaving_date <= current_date + greatest(p_days, 0)
    ),
    '[]'::jsonb
  );
end;
$$;

-- ============================================================================
-- RPC: monthly_finance - collection vs expenses per month, for the chart
-- ============================================================================
create or replace function public.monthly_finance(p_months int default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := public.app_scope_user_id();
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  with months as (
    select generate_series(
      (date_trunc('month', current_date) - make_interval(months => greatest(p_months, 1) - 1))::date,
      date_trunc('month', current_date)::date,
      interval '1 month'
    )::date as month
  ),
  income as (
    select date_trunc('month', date)::date as month, sum(amount) as total
    from public.transactions
    where user_id = v_user
      and type = 'RENT'
      and date >= (date_trunc('month', current_date) - make_interval(months => greatest(p_months, 1) - 1))::date
    group by 1
  ),
  costs as (
    select date_trunc('month', date)::date as month, sum(amount) as total
    from public.expenses
    where user_id = v_user
      and date >= (date_trunc('month', current_date) - make_interval(months => greatest(p_months, 1) - 1))::date
    group by 1
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'month', to_char(m.month, 'YYYY-MM'),
      'label', to_char(m.month, 'Mon'),
      'collected', round(coalesce(i.total, 0), 2),
      'expenses', round(coalesce(e.total, 0), 2),
      'profit', round(coalesce(i.total, 0) - coalesce(e.total, 0), 2)
    )
    order by m.month
  ), '[]'::jsonb)
  from months m
  left join income i on i.month = m.month
  left join costs e on e.month = m.month;
end;
$$;

-- ============================================================================
-- RPC: log_audit - append to the activity trail
-- ============================================================================
create or replace function public.log_audit(
  p_action text,
  p_entity_type text default '',
  p_entity_id text default null,
  p_summary text default '',
  p_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := public.app_scope_user_id();
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  insert into public.audit_log (id, user_id, actor_email, action, entity_type, entity_id, summary, amount)
  values (
    'aud_' || substr(md5(random()::text), 1, 12),
    v_user,
    coalesce(auth.jwt() ->> 'email', ''),
    p_action,
    coalesce(p_entity_type, ''),
    p_entity_id,
    coalesce(p_summary, ''),
    p_amount
  );

  return jsonb_build_object('logged', true);
end;
$$;

-- ============================================================================
-- RPC: audit_feed - most recent activity first
-- ============================================================================
create or replace function public.audit_feed(p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := public.app_scope_user_id();
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'actorEmail', a.actor_email,
          'action', a.action,
          'entityType', a.entity_type,
          'entityId', a.entity_id,
          'summary', a.summary,
          'amount', a.amount,
          'createdAt', a.created_at
        ) order by a.created_at desc
      )
      from (
        select * from public.audit_log
        where user_id = v_user
        order by created_at desc
        limit least(greatest(coalesce(p_limit, 100), 1), 500)
      ) a
    ),
    '[]'::jsonb
  );
end;
$$;

-- ============================================================================
-- RPC: generate_due_cycles - ensure every live tenant has an open cycle
--
-- Idempotent, so it is safe to run hourly from pg_cron. Returns how many cycles
-- it opened, so a caller can alert on anything other than zero.
-- ============================================================================
create or replace function public.generate_due_cycles()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user  uuid := public.app_scope_user_id();
  v_made  int := 0;
  rec     record;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  for rec in
    select c.id, c.next_due_date, c.rent_amount
    from public.customers c
    where c.user_id = v_user
      and c.status in ('active', 'notice')
      and not exists (
        select 1 from public.rent_cycles rc
        where rc.customer_id = c.id and rc.settled_at is null
      )
  loop
    insert into public.rent_cycles (id, user_id, customer_id, due_date, rent_amount, paid_amount)
    values (
      'cyc_' || substr(md5(random()::text), 1, 12),
      v_user, rec.id, rec.next_due_date, rec.rent_amount, 0
    )
    on conflict do nothing;

    v_made := v_made + 1;
  end loop;

  return jsonb_build_object('cyclesCreated', v_made);
end;
$$;

-- ============================================================================
-- Note on pg_cron
--
-- `generate_due_cycles` is per-user: it reads auth.uid(), so it must be called
-- with a signed-in landlord's token. pg_cron has no such token - it runs as a
-- role and would see auth.uid() as null. The wrapper below is the scheduled
-- entry point: it runs as SECURITY DEFINER, walks every owner and opens their
-- missing cycles explicitly, so it does not depend on auth.uid() at all.
--
-- Enable and schedule:
--   create extension if not exists pg_cron with schema extensions;
--   select cron.schedule('generate-due-cycles', '0 * * * *',
--     $$select public.generate_due_cycles_for_all()$$);
-- ============================================================================
create or replace function public.generate_due_cycles_for_all()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner  uuid;
  v_created int := 0;
  v_owners  int := 0;
  v_batch   int := 0;
begin
  for v_owner in
    select distinct user_id
    from public.customers
    where status in ('active', 'notice')
  loop
    v_owners := v_owners + 1;

    -- Idempotent: only tenants with no open cycle get one.
    insert into public.rent_cycles (id, user_id, customer_id, due_date, rent_amount, paid_amount)
    select
      'cyc_' || substr(md5(random()::text), 1, 12),
      v_owner,
      c.id,
      c.next_due_date,
      c.rent_amount,
      0
    from public.customers c
    where c.user_id = v_owner
      and c.status in ('active', 'notice')
      and not exists (
        select 1 from public.rent_cycles rc
        where rc.customer_id = c.id and rc.settled_at is null
      );

    get diagnostics v_batch = row_count;
    v_created := v_created + v_batch;
  end loop;

  return jsonb_build_object('ownersProcessed', v_owners, 'cyclesCreated', v_created);
end;
$$;

-- ============================================================================
-- GRANTS
-- Supabase's default privileges already cover tables in `public`, but RPCs are
-- granted explicitly here so a freshly-restored database behaves the same.
-- `revoke execute from anon` keeps every security-definer function above
-- unreachable without a signed-in account - they all assert auth.uid().
-- ============================================================================
revoke execute on function public.list_rooms() from public, anon;
revoke execute on function public.admit_customer(jsonb, text, text) from public, anon;
revoke execute on function public.move_customer(text, text, text, date) from public, anon;
revoke execute on function public.give_notice(text, date, text) from public, anon;
revoke execute on function public.vacate_customer(text, numeric, numeric, numeric, numeric, text, text) from public, anon;
revoke execute on function public.delete_room(text) from public, anon;
revoke execute on function public.dashboard_summary() from public, anon;
revoke execute on function public.upcoming_vacates(int) from public, anon;
revoke execute on function public.monthly_finance(int) from public, anon;
revoke execute on function public.log_audit(text, text, text, text, numeric) from public, anon;
revoke execute on function public.audit_feed(int) from public, anon;
revoke execute on function public.generate_due_cycles() from public, anon;

grant execute on function public.list_rooms() to authenticated;
grant execute on function public.admit_customer(jsonb, text, text) to authenticated;
grant execute on function public.move_customer(text, text, text, date) to authenticated;
grant execute on function public.give_notice(text, date, text) to authenticated;
grant execute on function public.vacate_customer(text, numeric, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.delete_room(text) to authenticated;
grant execute on function public.dashboard_summary() to authenticated;
grant execute on function public.upcoming_vacates(int) to authenticated;
grant execute on function public.monthly_finance(int) to authenticated;
grant execute on function public.log_audit(text, text, text, text, numeric) to authenticated;
grant execute on function public.audit_feed(int) to authenticated;
grant execute on function public.generate_due_cycles() to authenticated;

-- The scheduler runs as a role, not `authenticated`, so this one stays open.
-- service_role only, deliberately: it opens rent cycles for *every* owner on the
-- instance, so granting it to `authenticated` would let any signed-in user
-- write rows belonging to other accounts.
revoke execute on function public.generate_due_cycles_for_all() from public, anon;
grant execute on function public.generate_due_cycles_for_all() to service_role;

-- ############################################################################
-- # SECTION: 003_operations.sql
-- ############################################################################

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

create index if not exists complaints_user_status_idx on public.complaints (user_id, status);
create index if not exists complaints_user_created_idx on public.complaints (user_id, created_at desc);

-- ---------------------------------------------------------------- notices
create table if not exists public.notices (
  id         text primary key,
  user_id    uuid not null default public.app_scope_user_id(),
  title      text not null default '',
  body       text not null default '',
  date       date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notices_user_date_idx on public.notices (user_id, date desc);

-- -------------------------------------------------------------- enquiries
create table if not exists public.enquiries (
  id                  text primary key,
  user_id             uuid not null default public.app_scope_user_id(),
  name                text not null default '',
  phone               text not null default '',
  preferred_sharing   int not null default 1 check (preferred_sharing between 1 and 5),
  budget              numeric(12,2) not null default 0,
  expected_join_date  date,
  status              text not null default 'new'
    check (status in ('new', 'contacted', 'visited', 'joined', 'lost')),
  note                text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists enquiries_user_status_idx on public.enquiries (user_id, status);

-- --------------------------------------------------------------- visitors
create table if not exists public.visitors (
  id            text primary key,
  user_id       uuid not null default public.app_scope_user_id(),
  name          text not null default '',
  phone         text not null default '',
  visiting_whom text not null default '',
  purpose       text not null default '',
  in_time       text not null default '',
  out_time      text,
  date          date not null default current_date,
  created_at    timestamptz not null default now()
);

create index if not exists visitors_user_date_idx on public.visitors (user_id, date desc);

-- ------------------------------------------------------------------- RLS
alter table public.complaints enable row level security;
alter table public.notices enable row level security;
alter table public.enquiries enable row level security;
alter table public.visitors enable row level security;

drop policy if exists "own complaints" on public.complaints;
create policy "own complaints" on public.complaints
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own notices" on public.notices;
create policy "own notices" on public.notices
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own enquiries" on public.enquiries;
create policy "own enquiries" on public.enquiries
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own visitors" on public.visitors;
create policy "own visitors" on public.visitors
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());

-- ------------------------------------------------------- enquiry matching
-- Suggest enquiries whose preferred sharing type matches a room that just
-- gained a vacancy (used by the app when a tenant vacates).
create or replace function public.suggest_enquiries_for_room(p_room_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'name', e.name, 'phone', e.phone,
    'preferredSharing', e.preferred_sharing,
    'budget', e.budget::numeric,
    'expectedJoinDate', e.expected_join_date,
    'status', e.status
  ) order by e.created_at desc), '[]'::jsonb)
  from public.enquiries e
  where e.user_id = public.app_scope_user_id()
    and e.status in ('new', 'contacted', 'visited')
    and e.preferred_sharing = (
      select r.sharing_type from public.rooms r where r.id = p_room_id and r.user_id = public.app_scope_user_id()
    );
$$;

-- ############################################################################
-- # SECTION: 004_tenant_tools.sql
-- ############################################################################

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

create index if not exists agreements_customer_idx on public.agreements (customer_id);
create index if not exists agreements_user_idx on public.agreements (user_id);

-- ---------------------------------------------------------- rent revisions
-- History of rent changes (bulk or per customer). The customer row is updated
-- by the app; this table is the audit trail with the effective date.
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

create index if not exists rent_revisions_customer_idx on public.rent_revisions (customer_id);
create index if not exists rent_revisions_user_idx on public.rent_revisions (user_id, created_at desc);

-- ---------------------------------------------------------- meter readings
-- One reading per room per month. When the app "applies" a reading it splits
-- total_amount equally across the room's active occupants and creates one
-- light_bill row per occupant (rent stays separate).
create table if not exists public.meter_readings (
  id               text primary key,
  user_id          uuid not null default public.app_scope_user_id(),
  room_id          text references public.rooms (id) on delete cascade,
  room_no          text not null default '',
  month            text not null,               -- 'YYYY-MM'
  previous_reading numeric(12,2) not null default 0,
  current_reading  numeric(12,2) not null default 0,
  rate_per_unit    numeric(12,2) not null default 0,
  total_units      numeric(12,2),
  total_amount     numeric(12,2),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists meter_readings_room_month_idx
  on public.meter_readings (user_id, room_id, month);
create index if not exists meter_readings_user_idx on public.meter_readings (user_id, month desc);

-- Transactions get a LATE_FEE type so the line shows distinctly on receipts
-- and reports while flowing through the same ledger maths as rent.
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check
  check (type in ('RENT', 'LIGHT_BILL', 'REFUND', 'LATE_FEE'));

-- Late-fee line items hang off the tenant's open cycle.
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

create index if not exists late_fees_customer_idx on public.late_fees (customer_id);
create index if not exists late_fees_user_idx on public.late_fees (user_id);

-- ------------------------------------------------- settings: new switches
alter table public.settings add column if not exists upi_id text not null default '';
alter table public.settings add column if not exists late_fee_mode text not null default 'none'
  check (late_fee_mode in ('none', 'fixed', 'percent'));
alter table public.settings add column if not exists late_fee_value numeric(12,2) not null default 0;
alter table public.settings add column if not exists late_fee_grace_days int not null default 0;
alter table public.settings add column if not exists late_fee_max numeric(12,2);
alter table public.settings add column if not exists mess_enabled boolean not null default false;
alter table public.settings add column if not exists mess_charges numeric(12,2) not null default 0;

-- ------------------------------------------------------------ birthday cols
alter table public.customers add column if not exists birthday date;
alter table public.customers add column if not exists anniversary date;
alter table public.customers add column if not exists agreement_end_date date;

-- --------------------------------------------------------------- json shaper
create or replace function public.meter_reading_json(m public.meter_readings)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', m.id,
    'roomId', m.room_id,
    'roomNo', m.room_no,
    'month', m.month,
    'previousReading', m.previous_reading::numeric,
    'currentReading', m.current_reading::numeric,
    'ratePerUnit', m.rate_per_unit::numeric,
    'totalUnits', m.total_units::numeric,
    'totalAmount', m.total_amount::numeric,
    'createdAt', m.created_at,
    'updatedAt', m.updated_at
  );
$$;

-- ------------------------------------------------------------------- RLS
alter table public.agreements enable row level security;
alter table public.rent_revisions enable row level security;
alter table public.meter_readings enable row level security;
alter table public.late_fees enable row level security;

drop policy if exists "own agreements" on public.agreements;
create policy "own agreements" on public.agreements
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own rent revisions" on public.rent_revisions;
create policy "own rent revisions" on public.rent_revisions
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own meter readings" on public.meter_readings;
create policy "own meter readings" on public.meter_readings
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own late fees" on public.late_fees;
create policy "own late fees" on public.late_fees
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());

-- ############################################################################
-- # SECTION: 005_optional_features.sql
-- ############################################################################

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

create index if not exists assets_room_idx on public.assets (user_id, room_id);

-- -------------------------------------------------------------- mess menu
create table if not exists public.mess_menu (
  id         text primary key,
  user_id    uuid not null default public.app_scope_user_id(),
  day        text not null check (day in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')),
  meal       text not null check (meal in ('breakfast', 'lunch', 'dinner')),
  items      text not null default '',
  updated_at timestamptz not null default now()
);

create unique index if not exists mess_menu_day_meal_idx on public.mess_menu (user_id, day, meal);

-- ------------------------------------------------------------------- RLS
alter table public.assets enable row level security;
alter table public.mess_menu enable row level security;

drop policy if exists "own assets" on public.assets;
create policy "own assets" on public.assets
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());
drop policy if exists "own mess menu" on public.mess_menu;
create policy "own mess menu" on public.mess_menu
  to authenticated using (user_id = public.app_scope_user_id()) with check (user_id = public.app_scope_user_id());

-- ############################################################################
-- # SECTION: 006_late_fee_rpc.sql
-- ############################################################################

create or replace function public.record_flat_transaction(
  p_type       text,
  p_customer_id text,
  p_cycle_id   text,
  p_amount     numeric,
  p_date       date,
  p_mode       text,
  p_note       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user     uuid := public.app_scope_user_id();
  v_customer public.customers%rowtype;
  v_cycle    public.rent_cycles%rowtype;
  v_new_paid numeric;
  v_tx       public.transactions%rowtype;
begin
  if v_user is null then
    raise exception 'Incorrect login credentials.';
  end if;

  if p_type not in ('LATE_FEE') then
    raise exception 'Unsupported transaction type %.', p_type;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id and user_id = v_user;
  if not found then
    raise exception 'Tenant not found.';
  end if;

  -- Fall back to the tenant's open cycle when none was supplied.
  if p_cycle_id is not null and p_cycle_id <> '' then
    select * into v_cycle from public.rent_cycles
    where id = p_cycle_id and user_id = v_user;
    if not found then
      raise exception 'That rent cycle no longer exists.';
    end if;
  else
    select * into v_cycle from public.rent_cycles
    where customer_id = p_customer_id and user_id = v_user and settled_at is null
    order by due_date asc
    limit 1;
  end if;

  v_new_paid := coalesce(v_cycle.paid_amount, 0) + round(p_amount, 2);

  if v_cycle.id is not null then
    update public.rent_cycles
    set paid_amount = v_new_paid,
        settled_at = case when v_new_paid >= rent_amount then now() else settled_at end,
        updated_at = now()
    where id = v_cycle.id;
  end if;

  insert into public.transactions (
    id, user_id, customer_id, customer_name, type, cycle_id, bill_id,
    amount, date, mode, note, opened_cycle_id,
    settled_at, due_date_before, due_date_after, created_at
  ) values (
    'txn_' || substr(md5(random()::text), 1, 12),
    v_user, v_customer.id, v_customer.name, p_type, v_cycle.id, null,
    round(p_amount, 2), coalesce(p_date, current_date), coalesce(p_mode, 'cash'),
    coalesce(p_note, ''), null,
    case when v_cycle.id is not null and v_new_paid >= v_cycle.rent_amount then now() else null end,
    v_cycle.due_date, v_cycle.due_date, now()
  )
  returning * into v_tx;

  return jsonb_build_object(
    'id', v_tx.id,
    'customerId', v_tx.customer_id,
    'customerName', v_tx.customer_name,
    'type', v_tx.type,
    'cycleId', v_tx.cycle_id,
    'billId', v_tx.bill_id,
    'amount', v_tx.amount::numeric,
    'date', v_tx.date,
    'mode', v_tx.mode,
    'note', v_tx.note,
    'createdAt', v_tx.created_at
  );
end;
$$;

revoke execute on function public.record_flat_transaction(text, text, text, numeric, date, text, text) from public, anon;
grant execute on function public.record_flat_transaction(text, text, text, numeric, date, text, text) to authenticated;

-- ############################################################################
-- # SECTION: access control (admins allow-list, is_admin)
-- ############################################################################

-- ============================================================================
-- ACCESS CONTROL: the admins allowlist + Google sign-in
--
-- Appended last by scripts/build-schema.mjs. Everything above this section was
-- written when one account owned one PG and every row was scoped by
-- `user_id = public.app_scope_user_id()`. Google login changes two things:
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
     set user_id = public.app_scope_user_id()
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
drop policy if exists "read own allowlist entry" on public.admins;
create policy "read own allowlist entry" on public.admins
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "admins manage the team" on public.admins;
drop policy if exists "admins manage the team" on public.admins;
create policy "admins manage the team" on public.admins
  to authenticated
  using (public.is_admin() and public.has_role(array['owner', 'admin']))
  with check (public.is_admin() and public.has_role(array['owner', 'admin']));

grant select, insert, update, delete on public.admins to authenticated;
