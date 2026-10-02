-- ============================================================================
-- 005_optional_features.sql
-- Assets inventory per room and the weekly mess menu (both optional toggles).
-- ============================================================================

-- ------------------------------------------------------------------ assets
create table if not exists public.assets (
  id         text primary key,
  user_id    uuid not null default auth.uid(),
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
  user_id    uuid not null default auth.uid(),
  day        text not null check (day in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')),
  meal       text not null check (meal in ('breakfast', 'lunch', 'dinner')),
  items      text not null default '',
  updated_at timestamptz not null default now()
);

create unique index if not exists mess_menu_day_meal_idx on public.mess_menu (user_id, day, meal);

-- ------------------------------------------------------------------- RLS
alter table public.assets enable row level security;
alter table public.mess_menu enable row level security;

create policy "own assets" on public.assets
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own mess menu" on public.mess_menu
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
