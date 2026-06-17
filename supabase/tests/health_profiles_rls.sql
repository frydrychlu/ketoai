-- ============================================================================
-- RLS isolation proof for public.health_profiles  (S-02: health-profile)
-- ============================================================================
--
-- Copy of supabase/tests/meals_rls.sql, swapped to the health_profiles table.
-- Proves one user cannot see another user's profile. health_profiles is a
-- singleton per user (unique (user_id)), so each user seeds exactly one row.
--
-- HOW TO RUN locally (against the db container):
--   docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres < supabase/tests/health_profiles_rls.sql
--
-- The two UUIDs below must exist in auth.users. Create them by signing up twice
-- in the app (pointed at local), or insert them directly. See the WHY block in
-- isolation_canary_rls.sql for the role + claims dance.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Block 1 — impersonate USER A, seed A's profile (committed so it persists).
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  delete from public.health_profiles;                          -- RLS: only deletes A's own row
  insert into public.health_profiles (user_id, age, weight_kg, height_cm, activity_level, health_goals)
  values (auth.uid(), 40, 82, 180, 'moderate', 'A-goals');     -- INSERT policy WITH CHECK: must own
commit;


-- ---------------------------------------------------------------------------
-- Block 2 — impersonate USER B, seed B's profile (committed so it persists).
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

  delete from public.health_profiles;                          -- RLS: only deletes B's own row
  insert into public.health_profiles (user_id, age, weight_kg, height_cm, activity_level, health_goals)
  values (auth.uid(), 28, 60, 165, 'light', 'B-goals');
commit;


-- ---------------------------------------------------------------------------
-- Block 3 — impersonate USER B and ASSERT isolation (read-only; rolled back).
--   EXPECTED: NOTICE "RLS OK ..." and b_visible_rows = 1 (only B's profile).
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

  do $$
  declare
    leaked int;
  begin
    select count(*) into leaked
    from public.health_profiles
    where user_id <> auth.uid();

    if leaked > 0 then
      raise exception 'RLS FAIL: user B can see % profile(s) it does not own', leaked;
    end if;
    raise notice 'RLS OK: user B sees only its own profile';
  end $$;

  select count(*) as b_visible_rows from public.health_profiles;
rollback;


-- ---------------------------------------------------------------------------
-- Block 4 — UNRESTRICTED sanity check (default role, RLS bypassed).
--   EXPECTED: 2 rows total — A's and B's profiles. Seeing both users' rows here
--   while Block 3 saw only B's proves isolation came from RLS.
-- ---------------------------------------------------------------------------
select user_id, health_goals from public.health_profiles order by health_goals;
