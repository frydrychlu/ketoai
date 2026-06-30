-- S-04: activity-logging
-- Per-user physical-activity table. Follows the proven isolation pattern from
-- 20260609151323_isolation_canary.sql exactly:
--   1. user_id uuid not null references auth.users(id) on delete cascade
--   2. enable row level security
--   3. one granular policy per operation, scoped to role `authenticated`,
--      keyed on `auth.uid() = user_id` (writes also guarded with `with check`)
--
-- Activity-specific columns:
--   description    raw text the user typed (kept for re-display + later AI-analysis context)
--   calories_kcal  estimated caloric expenditure from the LLM (a failed estimate never reaches
--                  insert, so this is always present; non-negative)
--   day            the client-reported LOCAL calendar date this activity counts toward (not derived
--                  from UTC now() — the browser supplies it so the daily total groups correctly)
--   logged_at      server insert timestamp
--
-- Unlike meals/biomarkers there is NO unique constraint: a user logs many
-- activities per day.

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  description text not null,
  calories_kcal numeric not null check (calories_kcal >= 0),
  day date not null,
  logged_at timestamptz not null default now()
);

-- Keeps the per-user daily-expenditure filter (where user_id = ? and day = ?) cheap.
-- Non-unique: many activities per day.
create index activities_user_id_day_idx on public.activities (user_id, day);

alter table public.activities enable row level security;

-- A user may read only their own rows.
create policy "activities_select_own"
  on public.activities
  for select
  to authenticated
  using (auth.uid() = user_id);

-- A user may insert rows only for themselves.
create policy "activities_insert_own"
  on public.activities
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- A user may update only their own rows, and may not reassign ownership away from themselves.
create policy "activities_update_own"
  on public.activities
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A user may delete only their own rows.
create policy "activities_delete_own"
  on public.activities
  for delete
  to authenticated
  using (auth.uid() = user_id);
