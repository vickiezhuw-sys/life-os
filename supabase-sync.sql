create table if not exists public.life_os_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.life_os_state enable row level security;

drop policy if exists "life_os_state_select_own" on public.life_os_state;
create policy "life_os_state_select_own"
on public.life_os_state for select
using (auth.uid() = user_id);

drop policy if exists "life_os_state_insert_own" on public.life_os_state;
create policy "life_os_state_insert_own"
on public.life_os_state for insert
with check (auth.uid() = user_id);

drop policy if exists "life_os_state_update_own" on public.life_os_state;
create policy "life_os_state_update_own"
on public.life_os_state for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
