-- S-01: meal-macro-logging
-- Per-user meals table. Follows the proven isolation pattern from
-- 20260609151323_isolation_canary.sql exactly:
--   1. user_id uuid not null references auth.users(id) on delete cascade
--   2. enable row level security
--   3. one granular policy per operation, scoped to role `authenticated`,
--      keyed on `auth.uid() = user_id` (writes also guarded with `with check`)
--
-- Meal-specific columns:
--   description    raw text the user typed (kept for re-parsing + later AI-analysis context)
--   fat_g/protein_g/carbs_g/calories_kcal  macros parsed by the LLM (calories trusted as returned)
--   day           the client-reported LOCAL calendar date this meal counts toward (not derived
--                 from UTC now() — the browser supplies it so the daily total groups correctly)
--   logged_at     server insert timestamp

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  description text not null,
  fat_g numeric not null,
  protein_g numeric not null,
  carbs_g numeric not null,
  calories_kcal numeric not null,
  day date not null,
  logged_at timestamptz not null default now()
);

-- Keeps the per-user daily-total filter (where user_id = ? and day = ?) cheap.
create index meals_user_id_day_idx on public.meals (user_id, day);

alter table public.meals enable row level security;

-- A user may read only their own rows.
create policy "meals_select_own"
  on public.meals
  for select
  to authenticated
  using (auth.uid() = user_id);

-- A user may insert rows only for themselves.
create policy "meals_insert_own"
  on public.meals
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- A user may update only their own rows, and may not reassign ownership away from themselves.
create policy "meals_update_own"
  on public.meals
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A user may delete only their own rows.
create policy "meals_delete_own"
  on public.meals
  for delete
  to authenticated
  using (auth.uid() = user_id);
