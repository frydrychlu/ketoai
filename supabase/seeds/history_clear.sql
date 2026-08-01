-- ============================================================================
-- Clear (tear down) the seeded day-history used to verify /history
-- ============================================================================
--
-- DELETES one user's meals, activities, biomarker readings, and wellness entries
-- so the past-day view (and the trend charts) go back to their empty state. Runs
-- as `postgres` (bypasses RLS). This removes ALL of the target user's rows in
-- those four tables — on a local/test account that is exactly the seed data; do
-- not point it at an account whose real logs you want to keep.
--
-- Target user:
--   * default  — the most recently created auth.users row
--   * specific — pass -v seed_email=you@example.com
--
-- HOW TO RUN:
--   npm run clear:history
-- or directly:
--   docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres < supabase/seeds/history_clear.sql
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

\echo '>> Clearing day-history (meals, activities, biomarkers, wellness) for:'
select email, id as user_id from _clear_target;

delete from public.meals              where user_id = (select id from _clear_target);
delete from public.activities         where user_id = (select id from _clear_target);
delete from public.biomarker_readings where user_id = (select id from _clear_target);
delete from public.wellness_entries   where user_id = (select id from _clear_target);

\echo '>> Rows remaining for this user (all should be 0):'
select
  (select count(*) from public.meals              where user_id = (select id from _clear_target)) as meals,
  (select count(*) from public.activities         where user_id = (select id from _clear_target)) as activities,
  (select count(*) from public.biomarker_readings where user_id = (select id from _clear_target)) as biomarkers,
  (select count(*) from public.wellness_entries   where user_id = (select id from _clear_target)) as wellness;
