
-- MEDFLOW V11 — BANCO E SEGURANÇA
-- Cole no SQL Editor do Supabase e clique em Run.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  period integer check (period between 1 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_app_state enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "state_select_own" on public.user_app_state;
create policy "state_select_own"
on public.user_app_state for select
using (auth.uid() = user_id);

drop policy if exists "state_insert_own" on public.user_app_state;
create policy "state_insert_own"
on public.user_app_state for insert
with check (auth.uid() = user_id);

drop policy if exists "state_update_own" on public.user_app_state;
create policy "state_update_own"
on public.user_app_state for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "state_delete_own" on public.user_app_state;
create policy "state_delete_own"
on public.user_app_state for delete
using (auth.uid() = user_id);
