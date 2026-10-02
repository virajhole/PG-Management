-- ============================================================================
-- 003_operations.sql
-- Complaints / maintenance requests, notice board, enquiries / waiting list
-- and the visitor log. Additive only; every table is scoped to the owner.
-- ============================================================================

-- ------------------------------------------------------------- complaints
create table if not exists public.complaints (
  id            text primary key,
  user_id       uuid not null default auth.uid(),
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
  user_id    uuid not null default auth.uid(),
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
  user_id             uuid not null default auth.uid(),
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
  user_id       uuid not null default auth.uid(),
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

create policy "own complaints" on public.complaints
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notices" on public.notices
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own enquiries" on public.enquiries
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own visitors" on public.visitors
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

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
  where e.user_id = auth.uid()
    and e.status in ('new', 'contacted', 'visited')
    and e.preferred_sharing = (
      select r.sharing_type from public.rooms r where r.id = p_room_id and r.user_id = auth.uid()
    );
$$;
