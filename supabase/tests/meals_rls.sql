-- ============================================================================
-- RLS isolation proof for public.meals  (S-01: meal-macro-logging)
-- ============================================================================
--
-- Copy of supabase/tests/isolation_canary_rls.sql, swapped to the meals table
-- (with the not-null meal columns filled in). Proves one user cannot see
-- another user's meals.
--
-- HOW TO RUN locally (against the db container):
--   docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres < supabase/tests/meals_rls.sql
--
-- The two UUIDs below must exist in auth.users. Create them by signing up twice
-- in the app (pointed at local), or insert them directly. See the WHY block in
-- isolation_canary_rls.sql for the role + claims dance.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Block 1 — impersonate USER A, seed A's meals (committed so they persist).
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  delete from public.meals;                                    -- RLS: only deletes A's own rows
  insert into public.meals (user_id, description, fat_g, protein_g, carbs_g, calories_kcal, day)
  values
    (auth.uid(), 'A-meal-1', 10, 20, 5, 190, current_date),
    (auth.uid(), 'A-meal-2', 30, 10, 2, 318, current_date);   -- INSERT policy WITH CHECK: must own
commit;


-- ---------------------------------------------------------------------------
-- Block 2 — impersonate USER B, seed B's meal (committed so it persists).
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

  delete from public.meals;                                    -- RLS: only deletes B's own rows
  insert into public.meals (user_id, description, fat_g, protein_g, carbs_g, calories_kcal, day)
  values (auth.uid(), 'B-meal-1', 5, 5, 1, 69, current_date);
commit;


-- ---------------------------------------------------------------------------
-- Block 3 — impersonate USER B and ASSERT isolation (read-only; rolled back).
--   EXPECTED: NOTICE "RLS OK ..." and b_visible_rows = 1 (only B's meal).
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

  do $$
  declare
    leaked int;
  begin
    select count(*) into leaked
    from public.meals
    where user_id <> auth.uid();

    if leaked > 0 then
      raise exception 'RLS FAIL: user B can see % meal(s) it does not own', leaked;
    end if;
    raise notice 'RLS OK: user B sees only its own meals';
  end $$;

  select count(*) as b_visible_rows from public.meals;
rollback;


-- ---------------------------------------------------------------------------
-- Block 4 — UNRESTRICTED sanity check (default role, RLS bypassed).
--   EXPECTED: 3 rows total — A-meal-1, A-meal-2, B-meal-1. Seeing both users'
--   rows here while Block 3 saw only B's proves isolation came from RLS.
-- ---------------------------------------------------------------------------
select user_id, description from public.meals order by description;
