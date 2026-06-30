-- S-03: biomarker-gki-logging
-- Per-user SINGLETON-PER-DAY biomarker readings table. Follows the proven
-- isolation pattern from 20260609151323_isolation_canary.sql exactly:
--   1. user_id uuid not null references auth.users(id) on delete cascade
--   2. enable row level security
--   3. one granular policy per operation, scoped to role `authenticated`,
--      keyed on `auth.uid() = user_id` (writes also guarded with `with check`)
--
-- Blends two precedents:
--   * meals' `day date` column — the client-reported LOCAL calendar date the
--     reading counts toward (not derived from UTC now()).
--   * health_profiles' singleton upsert — here scoped per DAY: a
--     `unique (user_id, day)` constraint enforces one reading per user per day.
--     The API upserts on that conflict target (.upsert(..., { onConflict: "user_id,day" })).
--
-- Reading columns:
--   ketones_mmol_l  blood ketones in mmol/L (fixed unit). CHECK > 0 is the GKI
--                   div-by-zero guard; <= 20 is a sane upper bound.
--   glucose_mg_dl   blood glucose in mg/dL (fixed unit), bounded 20..600.
--   gki             glycemic-ketone index, computed server-side as
--                   (glucose_mg_dl / 18) / ketones_mmol_l and STORED (not user-entered).
--                   Non-null because both inputs are required.
--   created_at / updated_at  row timestamps

create table public.biomarker_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  ketones_mmol_l numeric not null,
  glucose_mg_dl numeric not null,
  gki numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day),
  constraint biomarker_readings_ketones_check check (ketones_mmol_l > 0 and ketones_mmol_l <= 20),
  constraint biomarker_readings_glucose_check check (glucose_mg_dl between 20 and 600)
);

-- The `unique (user_id, day)` constraint above already provides the index that
-- backs the per-user daily lookup (where user_id = ? and day = ?), so no
-- separate index is needed (unlike meals, whose (user_id, day) is non-unique).

alter table public.biomarker_readings enable row level security;

-- A user may read only their own readings.
create policy "biomarker_readings_select_own"
  on public.biomarker_readings
  for select
  to authenticated
  using (auth.uid() = user_id);

-- A user may insert readings only for themselves.
create policy "biomarker_readings_insert_own"
  on public.biomarker_readings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- A user may update only their own readings, and may not reassign ownership away from themselves.
create policy "biomarker_readings_update_own"
  on public.biomarker_readings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A user may delete only their own readings.
create policy "biomarker_readings_delete_own"
  on public.biomarker_readings
  for delete
  to authenticated
  using (auth.uid() = user_id);
