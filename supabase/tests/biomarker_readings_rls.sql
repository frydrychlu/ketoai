-- ============================================================================
-- RLS isolation proof for public.biomarker_readings  (S-03: biomarker-gki-logging)
-- ============================================================================
--
-- Copy of supabase/tests/meals_rls.sql, swapped to the biomarker_readings table
-- (with the not-null reading columns filled in, including a `gki` consistent
-- with the formula (glucose_mg_dl / 18) / ketones_mmol_l). Proves one user
-- cannot see another user's readings.
--
-- Because `(user_id, day)` is unique, each user seeds exactly one row for
-- current_date.
--
-- HOW TO RUN locally (against the db container):
--   docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres < supabase/tests/biomarker_readings_rls.sql
--
-- The two UUIDs below must exist in auth.users. Create them by signing up twice
-- in the app (pointed at local), or insert them directly. See the WHY block in
-- isolation_canary_rls.sql for the role + claims dance.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Block 1 — impersonate USER A, seed A's reading (committed so it persists).
--   ketones 1.0, glucose 90 -> gki (90 / 18) / 1.0 = 5.0
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  delete from public.biomarker_readings;                       -- RLS: only deletes A's own rows
  insert into public.biomarker_readings (user_id, day, ketones_mmol_l, glucose_mg_dl, gki)
  values (auth.uid(), current_date, 1.0, 90, 5.0);             -- INSERT policy WITH CHECK: must own
commit;


-- ---------------------------------------------------------------------------
-- Block 2 — impersonate USER B, seed B's reading (committed so it persists).
--   ketones 2.0, glucose 108 -> gki (108 / 18) / 2.0 = 3.0
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

  delete from public.biomarker_readings;                       -- RLS: only deletes B's own rows
  insert into public.biomarker_readings (user_id, day, ketones_mmol_l, glucose_mg_dl, gki)
  values (auth.uid(), current_date, 2.0, 108, 3.0);
commit;


-- ---------------------------------------------------------------------------
-- Block 3 — impersonate USER B and ASSERT isolation (read-only; rolled back).
--   EXPECTED: NOTICE "RLS OK ..." and b_visible_rows = 1 (only B's reading).
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

  do $$
  declare
    leaked int;
  begin
    select count(*) into leaked
    from public.biomarker_readings
    where user_id <> auth.uid();

    if leaked > 0 then
      raise exception 'RLS FAIL: user B can see % reading(s) it does not own', leaked;
    end if;
    raise notice 'RLS OK: user B sees only its own readings';
  end $$;

  select count(*) as b_visible_rows from public.biomarker_readings;
rollback;


-- ---------------------------------------------------------------------------
-- Block 4 — UNRESTRICTED sanity check (default role, RLS bypassed).
--   EXPECTED: 2 rows total — one for A (gki 5.0), one for B (gki 3.0). Seeing
--   both users' rows here while Block 3 saw only B's proves isolation came from RLS.
-- ---------------------------------------------------------------------------
select user_id, day, ketones_mmol_l, glucose_mg_dl, gki from public.biomarker_readings order by gki;
