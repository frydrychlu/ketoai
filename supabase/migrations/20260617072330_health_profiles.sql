-- S-02: health-profile
-- Per-user SINGLETON health profile. Follows the proven isolation pattern from
-- 20260609151323_isolation_canary.sql exactly:
--   1. user_id uuid not null references auth.users(id) on delete cascade
--   2. enable row level security
--   3. one granular policy per operation, scoped to role `authenticated`,
--      keyed on `auth.uid() = user_id` (writes also guarded with `with check`)
--
-- Singleton difference from meals (a one-to-many collection): a `unique (user_id)`
-- constraint enforces one profile row per user. The API upserts on that conflict
-- target (.upsert(..., { onConflict: "user_id" })).
--
-- Profile columns (all nullable — partial saves are allowed; omitted/cleared fields
-- are stored as NULL). CHECK guards pass on NULL, so range/enum validation does not
-- block partial saves:
--   age            integer years
--   weight_kg      body weight in kilograms (fixed metric unit)
--   height_cm      height in centimetres (fixed metric unit)
--   activity_level five-level enum, stored as text + CHECK list (trivially extendable
--                  via a follow-up migration, unlike a Postgres enum type)
--   health_goals   freeform text
--   created_at / updated_at  row timestamps

create table public.health_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  age integer,
  weight_kg numeric,
  height_cm numeric,
  activity_level text,
  health_goals text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  constraint health_profiles_age_check check (age is null or (age between 13 and 120)),
  constraint health_profiles_weight_kg_check check (weight_kg is null or (weight_kg between 20 and 500)),
  constraint health_profiles_height_cm_check check (height_cm is null or (height_cm between 50 and 250)),
  constraint health_profiles_activity_level_check
    check (activity_level is null or activity_level in ('sedentary', 'light', 'moderate', 'very', 'extra'))
);

alter table public.health_profiles enable row level security;

-- A user may read only their own profile.
create policy "health_profiles_select_own"
  on public.health_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

-- A user may insert a profile only for themselves.
create policy "health_profiles_insert_own"
  on public.health_profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- A user may update only their own profile, and may not reassign ownership away from themselves.
create policy "health_profiles_update_own"
  on public.health_profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A user may delete only their own profile.
create policy "health_profiles_delete_own"
  on public.health_profiles
  for delete
  to authenticated
  using (auth.uid() = user_id);
