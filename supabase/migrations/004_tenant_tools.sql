-- ============================================================================
-- 004_tenant_tools.sql
-- Digital agreements, late fee settings + late fee line items, bulk rent
-- revision history and per-room electricity meter readings.
-- ============================================================================

-- -------------------------------------------------------------- agreements
-- One row per generated agreement. The PDF and signature PNG land in the
-- private identity-docs bucket under agreements/ (owner-scoped, same as ID
-- proofs); only the storage paths are stored here.
create table if not exists public.agreements (
  id             text primary key,
  user_id        uuid not null default auth.uid(),
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
  user_id        uuid not null default auth.uid(),
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
  user_id          uuid not null default auth.uid(),
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
  user_id     uuid not null default auth.uid(),
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

create policy "own agreements" on public.agreements
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rent revisions" on public.rent_revisions
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own meter readings" on public.meter_readings
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own late fees" on public.late_fees
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
