create table if not exists public.diet_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.diet_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_date date not null,
  record jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, record_date)
);

create index if not exists diet_records_user_id_idx on public.diet_records(user_id);
alter table public.diet_profiles enable row level security;
alter table public.diet_records enable row level security;
revoke all on public.diet_profiles from anon;
revoke all on public.diet_records from anon;
grant select, insert, update, delete on public.diet_profiles to authenticated;
grant select, insert, update, delete on public.diet_records to authenticated;

drop policy if exists "profiles_select_own" on public.diet_profiles;
create policy "profiles_select_own" on public.diet_profiles for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists "profiles_insert_own" on public.diet_profiles;
create policy "profiles_insert_own" on public.diet_profiles for insert to authenticated
with check ((select auth.uid()) = user_id);
drop policy if exists "profiles_update_own" on public.diet_profiles;
create policy "profiles_update_own" on public.diet_profiles for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "records_select_own" on public.diet_records;
create policy "records_select_own" on public.diet_records for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists "records_insert_own" on public.diet_records;
create policy "records_insert_own" on public.diet_records for insert to authenticated
with check ((select auth.uid()) = user_id);
drop policy if exists "records_update_own" on public.diet_records;
create policy "records_update_own" on public.diet_records for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "records_delete_own" on public.diet_records;
create policy "records_delete_own" on public.diet_records for delete to authenticated
using ((select auth.uid()) = user_id);
