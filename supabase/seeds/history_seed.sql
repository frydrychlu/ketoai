-- ============================================================================
-- Seed a full day-history for verifying the S-08 read-only view (/history)
-- ============================================================================
--
-- Inserts ~30 days of MEALS, ACTIVITIES, BIOMARKERS, and WELLNESS entries for
-- ONE user so the past-day view has realistic data of every type to render —
-- including the empty-state edge cases the view must handle.
--
-- This runs as the `postgres` superuser, so it BYPASSES RLS — that is how it can
-- write rows on the user's behalf. Every `user_id` still references auth.users,
-- so a matching user must exist (sign up once in the app pointed at local).
--
-- Target user:
--   * default  — the most recently created auth.users row
--   * specific — pass -v seed_email=you@example.com
--
-- The generated series is deliberately UNEVEN so /history exercises its per-type
-- empty states, not just the happy path:
--   * meals       3 rotating keto meals/day, EXCEPT days where n % 7 = 5 (meal-less days)
--   * activities  only on even days (every other day is activity-free); a 2nd
--                 activity on days where n % 4 = 0
--   * biomarkers  one reading/day (same realistic range + formula as seed:trends),
--                 EXCEPT n = 14 (one gap day)
--   * wellness    one singleton/day, EXCEPT days where n % 6 = 4; `notes` is null
--                 on some days (partial-save look)
--   * n = 27      forced fully EMPTY across every type (tests the all-empty day)
--
-- Biomarker rows match the app's stored formula gki = (glucose_mg_dl / 18) / ketones,
-- so this seed alone fully populates /trends too (it re-seeds biomarker_readings
-- the same way seed:trends does — running either after the other is harmless).
--
-- HOW TO RUN (from the repo root, local stack up via `npx supabase start`):
--   npm run seed:history
-- or directly:
--   docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres < supabase/seeds/history_seed.sql
-- for a specific account:
--   docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v seed_email=you@example.com < supabase/seeds/history_seed.sql
-- ============================================================================

-- Default seed_email to empty when -v was not supplied (so :'seed_email' resolves).
\if :{?seed_email}
\else
  \set seed_email ''
\endif

-- Resolve the single target user (matched email, else most recent signup).
create temporary table _seed_target as
select id, email
from auth.users
where (nullif(:'seed_email', '') is null or lower(email) = lower(:'seed_email'))
order by created_at desc
limit 1;

do $$
begin
  if not exists (select 1 from _seed_target) then
    raise exception
      'No matching auth.users row found. Sign up once in the app (pointed at local Supabase), or check the seed_email you passed.';
  end if;
end $$;

\echo '>> Seeding day-history (meals, activities, biomarkers, wellness) for:'
select email as seeding_for, id as user_id from _seed_target;

-- Clean this user's prior rows so the seed is repeatable (RLS bypassed).
delete from public.meals             where user_id = (select id from _seed_target);
delete from public.activities        where user_id = (select id from _seed_target);
delete from public.biomarker_readings where user_id = (select id from _seed_target);
delete from public.wellness_entries  where user_id = (select id from _seed_target);

-- --------------------------------------------------------------------------
-- Meals: 3 rotating keto meals per day (idx n%7, (n+2)%7, (n+4)%7).
-- logged_at spreads meals across the morning so order-by-logged_at is stable.
-- Skips days where n % 7 = 5, plus the forced-empty day 27.
-- --------------------------------------------------------------------------
insert into public.meals (user_id, description, fat_g, protein_g, carbs_g, calories_kcal, day, logged_at)
select
  t.id,
  m.description, m.fat_g, m.protein_g, m.carbs_g, m.calories_kcal,
  current_date - d.n,
  (current_date - d.n)::timestamp + ((8 + m.idx) * interval '1 hour')
from _seed_target t
cross join generate_series(0, 29) as d(n)
join lateral (
  select * from (values
    (0, 'Jajecznica z 3 jajek na maśle',       28, 21,  2, 350),
    (1, 'Awokado z oliwą i solą',              22,  3,  4, 230),
    (2, 'Łosoś pieczony ze szpinakiem',        30, 34,  6, 430),
    (3, 'Sałatka z kurczakiem i serem feta',   25, 30,  8, 390),
    (4, 'Boczek z jajkiem sadzonym',           35, 20,  1, 410),
    (5, 'Stek wołowy z masłem czosnkowym',     40, 45,  3, 560),
    (6, 'Ser żółty i orzechy włoskie',         33, 15,  5, 380)
  ) as mt(idx, description, fat_g, protein_g, carbs_g, calories_kcal)
  where mt.idx in (d.n % 7, (d.n + 2) % 7, (d.n + 4) % 7)
) m on true
where d.n % 7 <> 5
  and d.n <> 27;

-- --------------------------------------------------------------------------
-- Activities: only on even days; a 2nd activity when n % 4 = 0.
-- logged_at in the afternoon/evening.
-- --------------------------------------------------------------------------
insert into public.activities (user_id, description, calories_kcal, day, logged_at)
select
  t.id,
  a.description, a.calories_kcal,
  current_date - d.n,
  (current_date - d.n)::timestamp + ((17 + a.idx) * interval '1 hour')
from _seed_target t
cross join generate_series(0, 29) as d(n)
join lateral (
  select * from (values
    (0, 'Spacer 30 minut',            150),
    (1, 'Trening siłowy 45 minut',    300),
    (2, 'Bieganie 5 km',              420),
    (3, 'Jazda na rowerze 20 km',     500),
    (4, 'Joga 60 minut',              180)
  ) as at(idx, description, calories_kcal)
  where at.idx = (d.n % 5)
     or (d.n % 4 = 0 and at.idx = (d.n + 2) % 5)
) a on true
where d.n % 2 = 0
  and d.n <> 27;

-- --------------------------------------------------------------------------
-- Biomarkers: one reading/day (same range + formula as seed:trends). One gap
-- at n = 14, plus the forced-empty day 27.
-- --------------------------------------------------------------------------
insert into public.biomarker_readings (user_id, day, ketones_mmol_l, glucose_mg_dl, gki)
select
  t.id,
  current_date - s.n,
  s.ketones                                as ketones_mmol_l,
  s.glucose                                as glucose_mg_dl,
  round((s.glucose / 18.0) / s.ketones, 3) as gki
from _seed_target t
cross join (
  select
    g.n,
    round((0.6 + (g.n % 14) / 13.0 * 1.3)::numeric, 1) as ketones,
    (74 + (g.n % 11) * 2)                              as glucose
  from generate_series(0, 29) as g(n)
  where g.n <> 14
    and g.n <> 27
) s;

-- --------------------------------------------------------------------------
-- Wellness: one singleton/day; skips days where n % 6 = 4, plus day 27.
-- `notes` is null on ~1/3 of days to mimic partial saves.
-- --------------------------------------------------------------------------
insert into public.wellness_entries (user_id, day, mood, energy, sleep_quality, water_liters, notes)
select
  t.id,
  current_date - d.n,
  4 + (d.n % 6)                                       as mood,          -- 4..9
  3 + ((d.n + 2) % 7)                                 as energy,        -- 3..9
  5 + (d.n % 5)                                       as sleep_quality, -- 5..9
  round((2.0 + (d.n % 4) * 0.4)::numeric, 1)          as water_liters,  -- 2.0..3.2
  case d.n % 3
    when 0 then 'Dobre samopoczucie, dużo energii.'
    when 1 then 'Lekkie zmęczenie po treningu.'
    else null
  end                                                 as notes
from _seed_target t
cross join generate_series(0, 29) as d(n)
where d.n % 6 <> 4
  and d.n <> 27;

\echo '>> Done. Rows now stored for this user (per type):'
select
  (select count(*) from public.meals              where user_id = (select id from _seed_target)) as meals,
  (select count(*) from public.activities         where user_id = (select id from _seed_target)) as activities,
  (select count(*) from public.biomarker_readings where user_id = (select id from _seed_target)) as biomarkers,
  (select count(*) from public.wellness_entries   where user_id = (select id from _seed_target)) as wellness;
