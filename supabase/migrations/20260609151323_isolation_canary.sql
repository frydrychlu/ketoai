-- F-01: data-isolation-baseline
-- Reference table that proves and documents the per-user RLS isolation pattern
-- every later KetoAI table copies. It is intentionally minimal: id, owner FK,
-- and a label. No timestamps/triggers/grant hardening (kept lean by decision).
--
-- The pattern to copy for every user-owned table:
--   1. user_id uuid not null references auth.users(id) on delete cascade
--   2. enable row level security
--   3. one granular policy per operation, scoped to role `authenticated`,
--      keyed on `auth.uid() = user_id` (writes also guarded with `with check`)

create table public.isolation_canary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text
);

alter table public.isolation_canary enable row level security;

-- A user may read only their own rows.
create policy "isolation_canary_select_own"
  on public.isolation_canary
  for select
  to authenticated
  using (auth.uid() = user_id);

-- A user may insert rows only for themselves.
create policy "isolation_canary_insert_own"
  on public.isolation_canary
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- A user may update only their own rows, and may not reassign ownership away from themselves.
create policy "isolation_canary_update_own"
  on public.isolation_canary
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A user may delete only their own rows.
create policy "isolation_canary_delete_own"
  on public.isolation_canary
  for delete
  to authenticated
  using (auth.uid() = user_id);
