-- ============================================================================
-- 002_rooms_and_lifecycle.sql
-- Rooms, occupancy, the tenant lifecycle (notice / move / vacate), expenses
-- and an audit trail.
--
-- Additive only: existing columns and rows are left untouched, and every new
-- column is nullable or has a default, so this runs against a populated
-- database without a data migration. Occupancy is always *computed* from
-- customers - it is never stored, so it cannot drift out of sync.
-- ============================================================================

-- ============================================================================
-- ROOMS
-- `sharing_type` doubles as bed capacity (1 = single, 5 = five-sharing).
-- `monthly_rent` is nullable and falls back to the Settings price for the
-- sharing type, so a landlord can override one room without touching pricing.
-- ============================================================================
create table if not exists public.rooms (
  id                     text primary key,
  user_id                uuid not null default auth.uid(),
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
  user_id     uuid not null default auth.uid(),
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
  user_id    uuid not null default auth.uid(),
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
  user_id     uuid not null default auth.uid(),
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
create policy "own rooms" on public.rooms
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own room history" on public.room_history;
create policy "own room history" on public.room_history
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own audit log" on public.audit_log;
create policy "own audit log" on public.audit_log
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

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
  v_user uuid := auth.uid();
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
  v_user    uuid := auth.uid();
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
  v_user    uuid := auth.uid();
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
  v_user uuid := auth.uid();
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
  v_user      uuid := auth.uid();
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
  v_user    uuid := auth.uid();
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
  v_user      uuid := auth.uid();
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
  v_user uuid := auth.uid();
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
  v_user uuid := auth.uid();
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
  v_user uuid := auth.uid();
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
  v_user uuid := auth.uid();
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
  v_user  uuid := auth.uid();
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
