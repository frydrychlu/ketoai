-- ============================================================================
-- RLS isolation proof for public.wellness_entries  (S-05: wellness-logging)
-- ============================================================================
--
-- Copy of supabase/tests/biomarker_readings_rls.sql, swapped to the
-- wellness_entries table. Seeds a representative mix of filled + NULL fields
-- (every wellness field is nullable) and proves one user cannot see another
-- user's entries.
--
-- Because `(user_id, day)` is unique, each user seeds exactly one row for
-- current_date.
--
-- HOW TO RUN locally (against the db container):
--   docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres < supabase/tests/wellness_entries_rls.sql
--
-- The two UUIDs below must exist in auth.users. Create them by signing up twice
-- in the app (pointed at local), or insert them directly. See the WHY block in
-- isolation_canary_rls.sql for the role + claims dance.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Block 1 — impersonate USER A, seed A's entry (committed so it persists).
--   A logs a full entry: mood 8, energy 7, sleep 6, water 2.5, notes set.
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  delete from public.wellness_entries;                          -- RLS: only deletes A's own rows
  insert into public.wellness_entries (user_id, day, mood, energy, sleep_quality, water_liters, notes)
  values (auth.uid(), current_date, 8, 7, 6, 2.5, 'good day');  -- INSERT policy WITH CHECK: must own
commit;


-- ---------------------------------------------------------------------------
-- Block 2 — impersonate USER B, seed B's entry (committed so it persists).
--   B logs a PARTIAL entry: only mood 4, the rest NULL (optional fields).
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

  delete from public.wellness_entries;                          -- RLS: only deletes B's own rows
  insert into public.wellness_entries (user_id, day, mood)
  values (auth.uid(), current_date, 4);
commit;


-- ---------------------------------------------------------------------------
-- Block 3 — impersonate USER B and ASSERT isolation (read-only; rolled back).
--   EXPECTED: NOTICE "RLS OK ..." and b_visible_rows = 1 (only B's entry).
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

  do $$
  declare
    leaked int;
  begin
    select count(*) into leaked
    from public.wellness_entries
    where user_id <> auth.uid();

    if leaked > 0 then
      raise exception 'RLS FAIL: user B can see % entry(ies) it does not own', leaked;
    end if;
    raise notice 'RLS OK: user B sees only its own entries';
  end $$;

  select count(*) as b_visible_rows from public.wellness_entries;
rollback;


-- ---------------------------------------------------------------------------
-- Block 4 — UNRESTRICTED sanity check (default role, RLS bypassed).
--   EXPECTED: 2 rows total — A's full entry (mood 8) and B's partial entry
--   (mood 4, other columns NULL). Seeing both users' rows here while Block 3
--   saw only B's proves isolation came from RLS.
-- ---------------------------------------------------------------------------
select user_id, day, mood, energy, sleep_quality, water_liters, notes from public.wellness_entries order by mood;
