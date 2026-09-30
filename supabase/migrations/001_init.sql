-- ============================================================================
-- PG Manager - Supabase backend (schema v3, cloud)
--
-- Run this entire file in the Supabase SQL editor (or `supabase db push`) once,
-- before first deploy. It creates:
--   * the app tables (customers, rent_cycles, light_bills, transactions,
--     settings), each scoped to the signed-in user
--   * computed "remaining" views (amount - paid is derived, never stored)
--   * RLS on every table so only the owner's rows are visible
--   * a PRIVATE storage bucket for Aadhaar/PAN scans + signed-URL policies
--   * the RPCs the app uses for atomic writes (payments, bills, import, wipe)
-- ============================================================================

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
-- Every table carries `user_id default auth.uid()` so rows are automatically
-- scoped to the signed-in user and RLS never needs the client to pass an id.

create table if not exists public.customers (
  id              text primary key,
  user_id         uuid not null default auth.uid(),
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
  user_id       uuid not null default auth.uid(),
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
  user_id       uuid not null default auth.uid(),
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
  user_id          uuid not null default auth.uid(),
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
  user_id               uuid primary key default auth.uid(),
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
-- with `user_id = auth.uid()` internally.
-- ============================================================================
alter table public.customers enable row level security;
alter table public.rent_cycles enable row level security;
alter table public.light_bills enable row level security;
alter table public.transactions enable row level security;
alter table public.settings enable row level security;

create policy "own customers" on public.customers
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own cycles" on public.rent_cycles
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own light bills" on public.light_bills
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own transactions" on public.transactions
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own settings" on public.settings
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- PRIVATE STORAGE (identity documents)
-- Paths are `{auth.uid()}/c/{customerId}/photo|proof/{imageId}.jpg`; the app
-- reads them back through short-lived signed URLs only.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('identity-docs', 'identity-docs', false)
on conflict (id) do nothing;

drop policy if exists "identity-docs owner all" on storage.objects;
create policy "identity-docs owner all" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'identity-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'identity-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
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
  v_user      uuid := auth.uid();
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
  v_user     uuid := auth.uid();
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
  v_user     uuid := auth.uid();
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
  v_user            uuid := auth.uid();
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
  v_user     uuid := auth.uid();
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
  v_user uuid := auth.uid();
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
  v_user uuid := auth.uid();
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