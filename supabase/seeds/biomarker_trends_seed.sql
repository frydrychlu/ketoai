-- ============================================================================
-- Seed biomarker readings for verifying the S-06 trend charts (/trends)
-- ============================================================================
--
-- Inserts ~30 days of blood-ketone / glucose readings for ONE user so the GKI
-- hero chart, the ketones/glucose dual-axis chart, the ketosis bands, and the
-- connect-across-gaps line rendering all have data to draw.
--
-- This runs as the `postgres` superuser, so it BYPASSES RLS — that is how it can
-- write rows on the user's behalf. `user_id` still references auth.users, so a
-- matching user must exist (sign up once in the app pointed at local).
--
-- Target user:
--   * default  — the most recently created auth.users row
--   * specific — pass -v seed_email=you@example.com
--
-- The generated series deliberately:
--   * keeps readings in a realistic in-range window — ketones 0.6–1.9 mmol/L,
--     glucose 74–94 mg/dL (GKI lands in the low/moderate/minimal zones),
--   * leaves ONE gap (a single skipped day) so the line still connects across a
--     missing reading,
--   * matches the app's stored formula gki = (glucose_mg_dl / 18) / ketones.
--
-- HOW TO RUN (from the repo root, local stack up via `npx supabase start`):
--   npm run seed:trends
-- or directly:
--   docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres < supabase/seeds/biomarker_trends_seed.sql
-- for a specific account:
--   docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v seed_email=you@example.com < supabase/seeds/biomarker_trends_seed.sql
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

\echo '>> Seeding biomarker readings for:'
select email as seeding_for, id as user_id from _seed_target;

-- Clean this user's prior readings so the seed is repeatable (RLS bypassed).
delete from public.biomarker_readings
where user_id = (select id from _seed_target);

-- 30-day window (offset 0 = today), omitting a single day to leave one gap.
-- ketones cycle 0.6 .. 1.9 mmol/L; glucose cycle 74 .. 94 mg/dL. gki is computed
-- from the (rounded) stored ketones with the app's exact formula.
insert into public.biomarker_readings (user_id, day, ketones_mmol_l, glucose_mg_dl, gki)
select
  t.id,
  current_date - s.n,
  s.ketones                                    as ketones_mmol_l,
  s.glucose                                    as glucose_mg_dl,
  round((s.glucose / 18.0) / s.ketones, 3)     as gki
from _seed_target t
cross join (
  select
    g.n,
    round((0.6 + (g.n % 14) / 13.0 * 1.3)::numeric, 1) as ketones,
    (74 + (g.n % 11) * 2)                              as glucose
  from generate_series(0, 29) as g(n)
  where g.n <> 14   -- the single omitted day (one gap, mid-window)
) s;

\echo '>> Done. Rows now stored for this user:'
select count(*) as seeded_rows
from public.biomarker_readings
where user_id = (select id from _seed_target);
