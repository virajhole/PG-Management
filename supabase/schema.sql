-- ============================================================================
-- PG Manager - complete database schema
--
-- One small file, re-runnable. Paste the whole thing into the Supabase SQL
-- editor (new project: just run it; existing project: safe to run again).
--
-- Tables (6): settings, rooms, customers, rent_cycles, light_bills,
-- transactions. Every id is a database-generated uuid.
--
-- Access rule: anyone who signs in with a valid account (Google or
-- email + password) can use the app. Every policy simply requires an
-- authenticated user - there is no allow-list.
-- ============================================================================

-- --------------------------------------------------------------------- tables

create table if not exists public.settings (
  id                uuid primary key default gen_random_uuid(),
  pg_name           text not null default '',
  upi_id            text not null default '',
  sharing_prices    jsonb not null default '{"1":18000,"2":15000,"3":13000,"4":11000,"5":9000}',
  default_deposit   numeric(12,2) not null default 5000,
  terms             text not null default '',
  whatsapp_template text not null default
    'Hello {name}, your rent of {amount} was due on {due}. Kindly pay at your earliest. - {pg}',
  updated_at        timestamptz not null default now()
);

create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  floor        int not null default 0,
  room_no      text not null default '',
  sharing_type int not null default 1 check (sharing_type between 1 and 5),
  -- null means "charge the Settings price for this sharing type"
  monthly_rent numeric(12,2),
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.customers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null default '',
  mobile         text not null default '',
  email          text not null default '',
  guardian_name  text not null default '',
  guardian_phone text not null default '',
  address        text not null default '',
  occupation     text not null default '',
  proof_type     text not null default 'AADHAAR' check (proof_type in ('AADHAAR', 'PAN')),
  proof_id       text not null default '',
  proof_path     text,
  photo_path     text,
  joining_date   date not null default current_date,
  sharing_type   int  not null default 1 check (sharing_type between 1 and 5),
  rent_amount    numeric(12,2) not null default 0,
  deposit_amount numeric(12,2) not null default 0,
  room_id        uuid references public.rooms (id) on delete set null,
  room_no        text not null default '',
  bed_no         text not null default '',
  notes          text not null default '',
  -- next_due_date mirrors the open rent cycle's due date (kept in sync by
  -- record_payment); due_day preserves the joining day-of-month so a 31st
  -- joiner does not drift to the 28th.
  due_day        int not null default 1,
  next_due_date  date not null default current_date,
  advance_credit numeric(12,2) not null default 0,
  status         text not null default 'active' check (status in ('active', 'vacated')),
  vacated_on     date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.rent_cycles (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  due_date    date not null,
  rent_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.light_bills (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  month       text not null default to_char(now(), 'YYYY-MM'),
  bill_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.transactions (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers (id) on delete cascade,
  -- name snapshot, so the payments list stays readable after checkout
  customer_name text not null default '',
  type          text not null check (type in ('RENT', 'LIGHT_BILL')),
  ref_id        uuid, -- the rent_cycle or light_bill this payment settled
  amount        numeric(12,2) not null default 0,
  date          date not null default current_date,
  mode          text not null default 'cash' check (mode in ('cash', 'upi', 'bank')),
  note          text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists customers_room_idx  on public.customers (room_id);
create index if not exists cycles_customer_idx on public.rent_cycles (customer_id);
create index if not exists bills_customer_idx  on public.light_bills (customer_id);
create index if not exists txs_customer_idx    on public.transactions (customer_id);
create index if not exists txs_ref_idx         on public.transactions (ref_id);
create index if not exists txs_date_idx        on public.transactions (date);

-- --------------------------------------------------------------- access rule
-- Signed-in users only. There is no allow-list: any valid Google or
-- email+password login can use the app.

alter table public.settings      enable row level security;
alter table public.rooms         enable row level security;
alter table public.customers     enable row level security;
alter table public.rent_cycles   enable row level security;
alter table public.light_bills   enable row level security;
alter table public.transactions  enable row level security;

-- Remove policies from any earlier version of this schema (including the old
-- admins allow-list rules) so the result is always exactly one policy.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['settings', 'rooms', 'customers', 'rent_cycles', 'light_bills', 'transactions', 'admins']
  loop
    if to_regclass('public.' || t) is not null then
      for p in
        select policyname from pg_policies
        where schemaname = 'public' and tablename = t
      loop
        execute format('drop policy if exists %I on public.%I', p.policyname, t);
      end loop;
    end if;
  end loop;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['settings', 'rooms', 'customers', 'rent_cycles', 'light_bills', 'transactions']
  loop
    execute format(
      'create policy "signed in all" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end;
$$;

-- The old allow-list table is no longer part of the app. Drop it if it exists
-- (its data is just e-mail addresses; nothing else references it).
drop table if exists public.admins;

-- ------------------------------------------------- identity documents bucket

insert into storage.buckets (id, name, public)
values ('identity-docs', 'identity-docs', false)
on conflict (id) do nothing;

drop policy if exists "admins manage identity docs" on storage.objects;
drop policy if exists "signed in manage identity docs" on storage.objects;
create policy "signed in manage identity docs" on storage.objects
  for all
  to authenticated
  using (bucket_id = 'identity-docs')
  with check (bucket_id = 'identity-docs');

-- ---------------------------------------------------------------- functions

-- Admission: the customer row plus their FIRST rent cycle, in one
-- transaction. With a room given, the free bed is re-checked under a row
-- lock, so two admissions for the last bed cannot both succeed.
create or replace function public.create_customer(
  p_customer jsonb,
  p_room_id  uuid default null,
  p_bed_no   text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_id       uuid;
  v_room     public.rooms%rowtype;
  v_occupied int;
  v_join     date := coalesce((p_customer ->> 'joiningDate')::date, current_date);
  v_rent     numeric(12,2) := coalesce((p_customer ->> 'rentAmount')::numeric, 0);
  v_due      date := v_join + interval '1 month';
begin
  if auth.uid() is null then
    raise exception 'Sign in to admit a tenant.';
  end if;
  if coalesce(btrim(coalesce(p_customer ->> 'name', '')), '') = '' then
    raise exception 'The tenant name is required.';
  end if;

  if p_room_id is not null then
    select * into v_room from public.rooms where id = p_room_id;
    if not found then
      raise exception 'That room no longer exists.';
    end if;

    select count(*) into v_occupied
    from public.customers
    where room_id = p_room_id and status = 'active';
    if v_occupied >= v_room.sharing_type then
      raise exception 'Room % is full. Pick another room.', v_room.room_no;
    end if;

    if coalesce(p_bed_no, '') <> '' and exists (
      select 1 from public.customers
      where room_id = p_room_id and bed_no = p_bed_no and status = 'active'
    ) then
      raise exception 'Bed % in room % is just taken.', p_bed_no, v_room.room_no;
    end if;
  end if;

  insert into public.customers (
    name, mobile, email, guardian_name, guardian_phone, address, occupation,
    proof_type, proof_id, joining_date, sharing_type, rent_amount, deposit_amount,
    room_id, room_no, bed_no, notes, due_day, next_due_date
  ) values (
    coalesce(p_customer ->> 'name', ''),
    coalesce(p_customer ->> 'mobile', ''),
    coalesce(p_customer ->> 'email', ''),
    coalesce(p_customer ->> 'guardianName', ''),
    coalesce(p_customer ->> 'guardianPhone', ''),
    coalesce(p_customer ->> 'address', ''),
    coalesce(p_customer ->> 'occupation', ''),
    coalesce(p_customer ->> 'proofType', 'AADHAAR'),
    coalesce(p_customer ->> 'proofId', ''),
    v_join,
    coalesce((p_customer ->> 'sharingType')::int, 1),
    v_rent,
    coalesce((p_customer ->> 'depositAmount')::numeric, 0),
    p_room_id,
    coalesce(v_room.room_no, coalesce(p_customer ->> 'roomNo', '')),
    coalesce(p_bed_no, ''),
    coalesce(p_customer ->> 'notes', ''),
    extract(day from v_join)::int,
    v_due
  )
  returning id into v_id;

  insert into public.rent_cycles (customer_id, due_date, rent_amount)
  values (v_id, v_due, greatest(v_rent, coalesce(v_room.monthly_rent, 0)));

  return jsonb_build_object('id', v_id);
end;
$$;

-- One payment against a rent cycle (default) or a light bill (p_bill_id).
-- Partial keeps the due date; settling opens the next month's cycle; the
-- surplus becomes advance credit on the customer.
create or replace function public.record_payment(
  p_customer_id uuid,
  p_amount      numeric,
  p_date        date default current_date,
  p_mode        text default 'cash',
  p_note        text default '',
  p_bill_id     uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  v_customer public.customers%rowtype;
  v_tx_id    uuid;
  v_amount   numeric(12,2) := round(p_amount::numeric, 2);
begin
  if auth.uid() is null then
    raise exception 'Sign in to record a payment.';
  end if;

  select * into v_customer from public.customers where id = p_customer_id;
  if not found then
    raise exception 'Customer not found.';
  end if;
  if v_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;

  if p_bill_id is not null then
    declare
      v_bill    public.light_bills%rowtype;
      v_applied numeric(12,2);
      v_surplus numeric(12,2);
    begin
      select * into v_bill from public.light_bills where id = p_bill_id;
      if not found then
        raise exception 'Light bill not found.';
      end if;

      v_applied := least(v_amount, greatest(v_bill.bill_amount - v_bill.paid_amount, 0));
      v_surplus := v_amount - v_applied;

      update public.light_bills
      set paid_amount = v_bill.paid_amount + v_applied, updated_at = now()
      where id = v_bill.id;

      if v_surplus > 0 then
        update public.customers
        set advance_credit = advance_credit + v_surplus
        where id = v_customer.id;
      end if;

      insert into public.transactions (customer_id, customer_name, type, ref_id, amount, date, mode, note)
      values (v_customer.id, v_customer.name, 'LIGHT_BILL', v_bill.id, v_amount, p_date, p_mode, p_note)
      returning id into v_tx_id;

      return jsonb_build_object('transactionId', v_tx_id, 'applied', v_applied, 'surplus', v_surplus);
    end;
  end if;

  declare
    v_cycle    public.rent_cycles%rowtype;
    v_applied  numeric(12,2);
    v_surplus  numeric(12,2);
    v_next_id  uuid;
    v_next_due date;
    v_pool     numeric(12,2);
    v_to_next  numeric(12,2);
  begin
    select * into v_cycle
    from public.rent_cycles
    where customer_id = v_customer.id
    order by due_date desc
    limit 1;
    if not found then
      raise exception 'No rent cycle for this tenant. Run supabase/schema.sql to repair.';
    end if;

    v_applied := least(v_amount, greatest(v_cycle.rent_amount - v_cycle.paid_amount, 0));
    v_surplus := v_amount - v_applied;

    update public.rent_cycles
    set paid_amount = v_cycle.paid_amount + v_applied, updated_at = now()
    where id = v_cycle.id;

    -- Settled in full: open the next month's cycle one month later. Surplus
    -- plus any advance credit pays into it; the rest stays as credit.
    if v_cycle.paid_amount + v_applied >= v_cycle.rent_amount then
      v_pool := v_surplus + v_customer.advance_credit;
      v_to_next := least(v_pool, v_customer.rent_amount);
      v_next_due := v_cycle.due_date + interval '1 month';

      insert into public.rent_cycles (customer_id, due_date, rent_amount, paid_amount)
      values (v_customer.id, v_next_due, v_customer.rent_amount, v_to_next)
      returning id into v_next_id;

      update public.customers
      set advance_credit = v_pool - v_to_next,
          next_due_date  = v_next_due
      where id = v_customer.id;
    end if;

    insert into public.transactions (customer_id, customer_name, type, ref_id, amount, date, mode, note)
    values (v_customer.id, v_customer.name, 'RENT', v_cycle.id, v_amount, p_date, p_mode, p_note)
    returning id into v_tx_id;

    return jsonb_build_object('transactionId', v_tx_id, 'applied', v_applied, 'surplus', v_surplus);
  end;
end;
$$;

-- Delete one payment and recalculate what it had settled. A rent payment that
-- was holding a cycle settled lets the cycle fall back to its remaining
-- transactions; the auto-created next cycle is withdrawn (its paid amount
-- returns to advance credit, minus the deleted payment's own surplus).
create or replace function public.delete_payment(p_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_tx      public.transactions%rowtype;
  v_applied numeric(12,2);
  v_surplus numeric(12,2);
  v_paid    numeric(12,2);
  v_cycle   public.rent_cycles%rowtype;
  v_next    public.rent_cycles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to delete a payment.';
  end if;

  select * into v_tx from public.transactions where id = p_id;
  if not found then
    return jsonb_build_object('deleted', false, 'reason', 'Payment already deleted or not found');
  end if;

  delete from public.transactions where id = p_id;

  if v_tx.type = 'RENT' and v_tx.ref_id is not null then
    select * into v_cycle from public.rent_cycles where id = v_tx.ref_id;
    if found then
      select coalesce(sum(amount), 0) into v_paid
      from public.transactions
      where type = 'RENT' and ref_id = v_cycle.id;

      v_applied := greatest(v_cycle.paid_amount - v_paid, 0);
      v_surplus := greatest(v_tx.amount - v_applied, 0);

      update public.rent_cycles
      set paid_amount = v_paid, updated_at = now()
      where id = v_cycle.id;

      if v_paid < v_cycle.rent_amount then
        -- The newest later cycle that no transaction points at is the one
        -- this payment's settlement auto-created.
        select * into v_next
        from public.rent_cycles rc
        where rc.customer_id = v_cycle.customer_id
          and rc.due_date > v_cycle.due_date
          and not exists (
            select 1 from public.transactions t
            where t.type = 'RENT' and t.ref_id = rc.id
          )
        order by rc.due_date asc
        limit 1;

        if found then
          update public.customers
          set advance_credit = greatest(advance_credit + v_next.paid_amount - v_surplus, 0),
              next_due_date  = v_cycle.due_date
          where id = v_cycle.customer_id;

          delete from public.rent_cycles where id = v_next.id;
        end if;
      end if;
    end if;
  elsif v_tx.type = 'LIGHT_BILL' and v_tx.ref_id is not null then
    update public.light_bills b
    set paid_amount = coalesce((
          select sum(t.amount) from public.transactions t
          where t.type = 'LIGHT_BILL' and t.ref_id = b.id
        ), 0),
        updated_at = now()
    where b.id = v_tx.ref_id;
  end if;

  return jsonb_build_object('deleted', true);
end;
$$;

grant execute on function public.create_customer(jsonb, uuid, text) to authenticated;
grant execute on function public.record_payment(uuid, numeric, date, text, text, uuid) to authenticated;
grant execute on function public.delete_payment(uuid) to authenticated;

-- ============================================================================
-- OPTIONAL: restrict the app to specific e-mails again
-- ----------------------------------------------------------------------------
-- If you ever want the allow-list back, run this block, then insert the
-- e-mails that may sign in:
--
--   create table if not exists public.admins (
--     email      text primary key check (email = lower(email)),
--     created_at timestamptz not null default now()
--   );
--   insert into admins (email) values ('you@gmail.com');
--
--   -- then replace "using (true) with check (true)" in the six policies above
--   -- with: using (exists (select 1 from admins a
--   --        where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))))
-- ============================================================================
