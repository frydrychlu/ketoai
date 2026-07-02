-- ============================================================================
-- Clear (tear down) the seeded biomarker readings used to verify /trends
-- ============================================================================
--
-- DELETES one user's biomarker readings so the trend charts go back to their
-- empty state. Runs as `postgres` (bypasses RLS). This removes ALL of the
-- target user's biomarker_readings — on a local/test account that is exactly
-- the seed data; do not point it at an account whose real readings you want to
-- keep.
--
-- Target user:
--   * default  — the most recently created auth.users row
--   * specific — pass -v seed_email=you@example.com
--
-- HOW TO RUN:
--   npm run clear:trends
-- or directly:
--   docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres < supabase/seeds/biomarker_trends_clear.sql
-- ============================================================================

\if :{?seed_email}
\else
  \set seed_email ''
\endif

create temporary table _clear_target as
select id, email
from auth.users
where (nullif(:'seed_email', '') is null or lower(email) = lower(:'seed_email'))
order by created_at desc
limit 1;

\echo '>> Clearing biomarker readings for:'
select email, id as user_id from _clear_target;

delete from public.biomarker_readings
where user_id = (select id from _clear_target);

\echo '>> Rows remaining for this user (should be 0):'
select count(*) as remaining_rows
from public.biomarker_readings
where user_id = (select id from _clear_target);
