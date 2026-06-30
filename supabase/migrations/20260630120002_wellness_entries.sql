-- S-05: wellness-logging
-- Per-user SINGLETON-PER-DAY wellness entries table. Follows the proven
-- isolation pattern from 20260609151323_isolation_canary.sql exactly:
--   1. user_id uuid not null references auth.users(id) on delete cascade
--   2. enable row level security
--   3. one granular policy per operation, scoped to role `authenticated`,
--      keyed on `auth.uid() = user_id` (writes also guarded with `with check`)
--
-- Blends two precedents:
--   * biomarker_readings' singleton-per-day cardinality — a `unique (user_id, day)`
--     constraint enforces one entry per user per day; the API upserts on that
--     conflict target (.upsert(..., { onConflict: "user_id,day" })).
--   * health_profiles' ALL-NULLABLE partial-save fields — every wellness field is
--     nullable, so the user may save any subset. A cleared field is written as
--     explicit null on the conflict-UPDATE path.
--
-- Entry columns (all nullable — partial save):
--   mood / energy / sleep_quality  subjective 1-10 self-ratings (integer, CHECK 1..10).
--   water_liters                   water intake in liters (numeric, CHECK 0..20).
--   notes                          freeform text, CHECK length <= 2000.
--   created_at / updated_at        row timestamps.
--
-- Range CHECKs on a nullable column pass automatically when the value is NULL
-- (a CHECK is satisfied unless it evaluates to false), so the all-optional
-- contract holds. There is intentionally NO table CHECK requiring at-least-one
-- field — that guard lives in the route's Zod schema, because clearing the whole
-- day is the DELETE path, not an empty upsert.

create table public.wellness_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  mood integer,
  energy integer,
  sleep_quality integer,
  water_liters numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day),
  constraint wellness_entries_mood_check check (mood between 1 and 10),
  constraint wellness_entries_energy_check check (energy between 1 and 10),
  constraint wellness_entries_sleep_quality_check check (sleep_quality between 1 and 10),
  constraint wellness_entries_water_check check (water_liters >= 0 and water_liters <= 20),
  constraint wellness_entries_notes_check check (char_length(notes) <= 2000)
);

-- The `unique (user_id, day)` constraint above already provides the index that
-- backs the per-user daily lookup (where user_id = ? and day = ?), so no
-- separate index is needed (same as biomarker_readings).

alter table public.wellness_entries enable row level security;

-- A user may read only their own entries.
create policy "wellness_entries_select_own"
  on public.wellness_entries
  for select
  to authenticated
  using (auth.uid() = user_id);

-- A user may insert entries only for themselves.
create policy "wellness_entries_insert_own"
  on public.wellness_entries
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- A user may update only their own entries, and may not reassign ownership away from themselves.
create policy "wellness_entries_update_own"
  on public.wellness_entries
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A user may delete only their own entries.
create policy "wellness_entries_delete_own"
  on public.wellness_entries
  for delete
  to authenticated
  using (auth.uid() = user_id);
