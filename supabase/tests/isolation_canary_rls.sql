-- ============================================================================
-- RLS isolation proof for public.isolation_canary  (F-01: data-isolation-baseline)
-- ============================================================================
--
-- This is the reusable verification recipe for the per-user RLS pattern. To prove
-- a future table, copy this file and swap the table name + the two user UUIDs.
--
-- HOW TO RUN (Supabase dashboard -> SQL Editor, or psql against the linked DB):
--   1. Create two users (sign up twice in the app, or add them via Dashboard -> Auth).
--   2. Get their UUIDs:   select id, email from auth.users order by created_at;
--   3. Replace EVERY <USER_A_UUID> and <USER_B_UUID> below with those two UUIDs.
--   4. Run the whole script top to bottom and read the output (see "EXPECTED" notes).
--
-- WHY the role + claims dance:
--   The SQL editor runs as a privileged role that BYPASSES row level security.
--   To actually exercise the policies you must, inside a transaction:
--     set local role authenticated;                  -- drop to the app's runtime role
--     set local request.jwt.claims to '{...}';        -- make auth.uid() resolve to a user
--   Without this, every query "passes" while really seeing all rows. Each block
--   below is wrapped in begin/commit (seeding) or begin/rollback (read-only check).
--
--   Seed blocks delete-then-insert that user's own rows first, so the script is
--   safe to re-run without piling up duplicate canary rows.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Block 1 — impersonate USER A, seed A's rows (committed so they persist).
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<USER_A_UUID>","role":"authenticated"}';

  delete from public.isolation_canary;                         -- RLS: only deletes A's own rows
  insert into public.isolation_canary (user_id, label)
  values (auth.uid(), 'A-row-1'), (auth.uid(), 'A-row-2');     -- INSERT policy WITH CHECK: must own
commit;


-- ---------------------------------------------------------------------------
-- Block 2 — impersonate USER B, seed B's rows (committed so they persist).
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<USER_B_UUID>","role":"authenticated"}';

  delete from public.isolation_canary;                         -- RLS: only deletes B's own rows
  insert into public.isolation_canary (user_id, label)
  values (auth.uid(), 'B-row-1');
commit;


-- ---------------------------------------------------------------------------
-- Block 3 — impersonate USER B and ASSERT isolation (read-only; rolled back).
--   EXPECTED: the DO block raises NOTICE "RLS OK ..." and does NOT raise an
--   exception; b_visible_rows = 1 (only B's row, none of A's two rows).
--   If the SELECT policy were too permissive, the DO block raises an exception.
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<USER_B_UUID>","role":"authenticated"}';

  do $$
  declare
    leaked int;
  begin
    -- Rows visible to B that B does NOT own. With working RLS this is 0,
    -- because the SELECT policy filters A's rows out before this predicate.
    select count(*) into leaked
    from public.isolation_canary
    where user_id <> auth.uid();

    if leaked > 0 then
      raise exception 'RLS FAIL: user B can see % row(s) it does not own', leaked;
    end if;
    raise notice 'RLS OK: user B sees only its own rows';
  end $$;

  select count(*) as b_visible_rows from public.isolation_canary;
rollback;


-- ---------------------------------------------------------------------------
-- Block 4 — UNRESTRICTED sanity check (default editor role, RLS bypassed).
--   Run this on its own. EXPECTED: 3 rows total — A-row-1, A-row-2, B-row-1.
--   Seeing BOTH users' rows here while Block 3 saw only B's proves the
--   isolation in Block 3 came from RLS, not from missing data.
-- ---------------------------------------------------------------------------
select user_id, label from public.isolation_canary order by label;
