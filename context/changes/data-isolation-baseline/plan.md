# Data Isolation Baseline (F-01) Implementation Plan

## Overview

Establish the two things every later KetoAI slice depends on: a repeatable, version-controlled
**Supabase migration workflow** against the cloud project, and a **proven per-user RLS isolation
pattern** that keeps one authenticated user's rows invisible to another. We prove the pattern on a
minimal throwaway/reference `isolation_canary` table (F-01 deliberately builds no domain feature
tables — meals, biomarkers, profile, etc. each add their own table later, copying this pattern).

This is the roadmap's F-01 foundation; it unblocks S-01–S-05. RLS is the stack's named-risk "skills"
gap, and a mis-set policy silently leaks personal health data — the roadmap's hard guardrail — so the
isolation contract is established and verified once, here, rather than re-derived per slice.

## Current State Analysis

- **Isolation mechanism is structurally wired but unused.** `src/lib/supabase.ts:9` creates an SSR
  client with the **anon key + the user's cookies**, and `src/middleware.ts:11-13` resolves
  `context.locals.user`. Every query therefore runs as the logged-in user, so Postgres RLS keyed on
  `auth.uid()` is the correct enforcement layer. It does not exist yet: there are no tables and no
  policies.
- **No migrations exist.** `supabase/config.toml` is present (`project_id = "10x-astro-starter"`,
  Postgres major version 17, local email confirmations off), but there is **no `supabase/migrations/`
  directory** and no `seed.sql`. Only Supabase Auth's `auth.users` is in use.
- **Cloud-only Supabase.** The user has no local Docker/`supabase start` environment; they operate a
  cloud Supabase project where they can create users and log in. Migrations must therefore reach the
  cloud DB. `supabase db push` against a **linked** project does this without Docker (one-time
  `supabase link` with project ref + DB password).
- **Conventions half-specified.** `AGENTS.md` already mandates the migration filename format
  (`YYYYMMDDHHmmss_short_description.sql`), RLS-always-on, and granular per-operation/per-role
  policies, and that the SSR client only be created via `src/lib/supabase.ts`. The reusable column
  conventions, the verification recipe, and the rollback story are not yet written down.
- **No test tooling.** Only ESLint + Prettier are installed (no Vitest/Jest/pgTAP). Verification will
  be a committed SQL script run against cloud, not an automated test in CI.

## Desired End State

After this plan:

1. `supabase/migrations/<ts>_isolation_canary.sql` exists in git, has been applied to the cloud
   project via `supabase db push`, and the `isolation_canary` table is live in cloud with RLS enabled
   and four granular `authenticated`-role policies.
2. A committed SQL impersonation script proves that, with two real cloud users A and B, user B's
   session sees only B's `isolation_canary` rows and none of A's (SELECT isolation).
3. `AGENTS.md` carries a concise "RLS & migration pattern" section documenting the canonical table
   template, the link/push workflow, and how to run the verification — the copy-source for every later
   table.

**Verification of end state:** running `supabase db push` reports no pending migrations; querying the
cloud DB shows the `isolation_canary` table with `rowsecurity = true` and 4 policies; running the
impersonation script returns only the impersonated user's rows.

### Key Discoveries:

- SSR client uses anon key + user cookies (`src/lib/supabase.ts:9-23`) → `auth.uid()`-based RLS is the
  right and only enforcement layer; no app-code changes are needed for isolation.
- Auth attaches `context.locals.user` (`src/middleware.ts:11-13`); the canary needs no UI — it is
  verified purely at the database layer.
- `AGENTS.md` hard rule: "always enable RLS with granular per-operation, per-role policies" — so the
  canary carries all 4 policies (SELECT/INSERT/UPDATE/DELETE) even though only SELECT isolation is
  asserted; an INSERT policy is also required just to seed the proof rows.
- The Supabase SQL editor / `postgres` role **bypasses RLS** by default; the verification script must
  explicitly `set local role authenticated` and set `request.jwt.claims` inside a transaction to
  exercise policies (see Phase 2 contract).

## What We're NOT Doing

- **No domain feature tables.** No meals, biomarkers, activity, wellness, or profile tables — those
  belong to S-01–S-05. The canary is the only table this plan creates.
- **No reusable scaffolding beyond RLS.** Per the user's "minimal" choice: no `created_at`/`updated_at`
  columns, no `set_updated_at()` trigger, no explicit `revoke from anon` / `force row level security`
  hardening baked into the template. Later tables decide those per-table.
- **No `public.profiles` mirror or signup trigger.** Ownership is a direct FK to `auth.users(id)`.
- **No new `docs/reference/` tree or `contract-surfaces.md` registry.** The pattern is documented inline
  in `AGENTS.md` (user's choice).
- **No test framework** (no Vitest/pgTAP) and **no CI gating** of the verification. CI stays lint+build.
- **No write-side isolation assertion.** INSERT/UPDATE/DELETE policies exist but only SELECT isolation
  is actively proven (see Open Risks).
- **No application UI** reading or writing the canary.

## Implementation Approach

Author the canary table as the first migration file, link the Supabase CLI to the cloud project once,
and apply with `supabase db push` — that single act proves the migration workflow and lands the RLS
pattern. Then write and run a SQL impersonation script that seeds rows for two real users and asserts
SELECT isolation, and record the canonical pattern in `AGENTS.md`. Migrations are forward-only; with no
production data in the canary, rollback is a manual `drop table` migration if ever needed.

## Critical Implementation Details

- **RLS bypass in the SQL editor.** The default `postgres`/service role bypasses RLS. The verification
  script MUST run inside a transaction that switches role and sets the JWT claims, or it will appear to
  "pass" while actually seeing everything:

  ```sql
  begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"<USER_A_UUID>","role":"authenticated"}';
  -- auth.uid() now returns USER_A_UUID; this select must return only A's rows
  select count(*) from public.isolation_canary;          -- expect: only A's rows
  rollback;
  ```

  The same block re-run with `<USER_B_UUID>` must return only B's rows. Seeding rows for A and B is
  done the same way (switch claims, `insert ... (auth.uid(), 'label')`), which also exercises the
  INSERT policy's `WITH CHECK` as a side effect even though it is not formally asserted.

- **`supabase link` is interactive and one-time.** It prompts for the database password and writes
  `supabase/.temp/` (already git-ignored). The project ref comes from the cloud dashboard URL. This is
  a human step, not an agent-runnable command.

## Phase 1: Migration workflow + canary table with RLS

### Overview

Create the first migration (the canary table + its RLS policies), link the CLI to the cloud project,
and apply it with `supabase db push`. Success means the migration workflow is proven and the table is
live in cloud with RLS on.

### Changes Required:

#### 1. First migration file

**File**: `supabase/migrations/20260609151323_isolation_canary.sql`

**Intent**: Create a minimal user-owned reference table whose sole purpose is to prove and document the
RLS isolation pattern every later table copies. Enable RLS and define granular per-operation policies so
each authenticated user can only touch their own rows.

**Contract**: Table `public.isolation_canary` with columns `id uuid primary key default
gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`, `label text`.
`alter table ... enable row level security`. Four policies for role `authenticated`, all keyed on
`auth.uid() = user_id`: SELECT (`using`), INSERT (`with check`), UPDATE (`using` + `with check`),
DELETE (`using`). No timestamps, trigger, or grant hardening (minimal template, per decision). Filename
follows the `AGENTS.md` `YYYYMMDDHHmmss_short_description.sql` rule.

#### 2. Link CLI to cloud (one-time, human step)

**File**: (no file — operational step; writes git-ignored `supabase/.temp/`)

**Intent**: Connect the local repo's Supabase CLI to the cloud project so migrations can be pushed
without a local Docker stack.

**Contract**: `npx supabase link --project-ref <ref>` (project ref from the dashboard URL; prompts for
DB password). Interactive — the human runs it.

### Success Criteria:

#### Automated Verification:

- Migration filename matches the convention: starts with a 14-digit timestamp + `_` + snake_case
  description, `.sql` extension.
- `npx supabase db push` applies the migration and reports no remaining pending migrations.
- `npm run lint` passes (no source files changed, but confirms repo is clean).

#### Manual Verification:

- In the cloud dashboard (Table Editor / SQL editor), `public.isolation_canary` exists with the three
  expected columns and the `auth.users` foreign key.
- `select relrowsecurity from pg_class where relname = 'isolation_canary';` returns `true`.
- `select polcmd, polname from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname =
  'isolation_canary';` shows four policies covering SELECT, INSERT, UPDATE, DELETE.

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation that
the table + policies are visible in the cloud dashboard before proceeding to Phase 2.

---

## Phase 2: Isolation verification + document the pattern

### Overview

Write and run a committed SQL impersonation script that seeds canary rows for two real cloud users and
asserts user B sees only B's rows. Then document the canonical RLS + migration pattern in `AGENTS.md`.

### Changes Required:

#### 1. Verification script

**File**: `supabase/tests/isolation_canary_rls.sql`

**Intent**: Provide a repeatable, tooling-free proof that RLS isolates rows per user — re-runnable for
every future table by swapping the table name and user UUIDs. Seeds rows as user A and user B, then
asserts each impersonated session reads only its own rows.

**Contract**: A SQL script (run in the cloud SQL editor or via `psql`) with three transaction blocks:
(1) impersonate A, insert A's rows; (2) impersonate B, insert B's rows; (3) impersonate B, `select
count(*)` and assert it equals only B's row count (and 0 of A's). Uses `set local role authenticated`
+ `set local request.jwt.claims` to set `auth.uid()` (see Critical Implementation Details). Real user
UUIDs come from `select id, email from auth.users;`. Header comment explains how to obtain UUIDs and
read the expected output.

#### 2. Document the pattern in AGENTS.md

**File**: `AGENTS.md`

**Intent**: Record the canonical table template, the link/push migration workflow, and the verification
recipe so later slices and agents copy a proven pattern instead of re-deriving RLS.

**Contract**: New section (e.g., "## Data Isolation & Migration Pattern") under the existing rules,
containing: the canary table as the reference template (columns + the 4 per-op `authenticated` policies
on `auth.uid() = user_id`), the `supabase link` + `supabase db push` cloud workflow, and a pointer to
`supabase/tests/isolation_canary_rls.sql` as the verification recipe. Kept terse to match AGENTS.md's
style.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes.
- The script file exists at `supabase/tests/isolation_canary_rls.sql` and `AGENTS.md` contains the new
  pattern section.

#### Manual Verification:

- Two cloud users exist (created via the app/dashboard); their UUIDs are pulled from `auth.users`.
- Running the script: after seeding, the user-B impersonation block returns **only B's rows** (0 of
  A's), and the user-A block returns only A's rows.
- Running a `select` against the canary as the default editor role (RLS bypassed) shows both users'
  rows — confirming the isolation seen above is RLS, not absence of data.

**Implementation Note**: After Phase 2, pause for manual confirmation that the impersonation script
demonstrates B cannot see A's rows.

---

## Testing Strategy

### Unit Tests:

- None — no test framework in the project and none added (per decision). Verification is the SQL
  impersonation script.

### Integration Tests:

- The impersonation script (`supabase/tests/isolation_canary_rls.sql`) is the end-to-end isolation
  check at the database layer.

### Manual Testing Steps:

1. Create two users in the cloud project (sign up twice via the app, or add via dashboard).
2. Get their UUIDs: `select id, email from auth.users;`.
3. Paste the UUIDs into the impersonation script and run it in the SQL editor.
4. Confirm the user-B block returns only B's rows; confirm the unrestricted (editor-role) query shows
   both users' rows.

## Performance Considerations

None. The canary holds a handful of rows and is never queried by the app. RLS policy evaluation on a
single `auth.uid() = user_id` predicate is negligible.

## Migration Notes

- Migrations are **forward-only**. With no production data in the canary, rollback (if ever needed) is a
  new `drop table public.isolation_canary;` migration, not a down-script.
- `supabase db push` applies pending migration files to the linked cloud DB in timestamp order. Keep the
  one-time `supabase link` credentials (DB password) handy; `supabase/.temp/` is git-ignored.
- Supabase schema migrations do **not** roll back with `wrangler rollback` — DB and Worker rollbacks are
  independent (per `infrastructure.md`).

## References

- Roadmap F-01: `context/foundation/roadmap.md` (lines 70–81)
- Infra constraints (cloud Supabase, migration/rollback): `context/foundation/infrastructure.md`
- SSR client (RLS enforcement boundary): `src/lib/supabase.ts:9-23`
- Auth middleware: `src/middleware.ts:11-13`
- Existing rules this plan extends: `AGENTS.md` (Hard Rules — migrations + RLS)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration workflow + canary table with RLS

#### Automated

- [x] 1.1 Migration filename matches the `YYYYMMDDHHmmss_short_description.sql` convention — a26e8ac
- [x] 1.2 `npx supabase db push` applies the migration with no remaining pending migrations — a26e8ac
- [x] 1.3 `npm run lint` passes — a26e8ac

#### Manual

- [x] 1.4 `public.isolation_canary` exists in cloud with the three columns + `auth.users` FK — a26e8ac
- [x] 1.5 `relrowsecurity` is `true` for `isolation_canary` — a26e8ac
- [x] 1.6 Four policies (SELECT/INSERT/UPDATE/DELETE) exist on the table — a26e8ac

### Phase 2: Isolation verification + document the pattern

#### Automated

- [x] 2.1 `npm run lint` passes — 00037a0
- [x] 2.2 `supabase/tests/isolation_canary_rls.sql` exists and `AGENTS.md` contains the pattern section — 00037a0

#### Manual

- [x] 2.3 Two cloud users exist and their UUIDs are pulled from `auth.users` — 00037a0
- [x] 2.4 Impersonation script: user-B block returns only B's rows (0 of A's); user-A block returns only A's — 00037a0
- [x] 2.5 Unrestricted (editor-role) query shows both users' rows, confirming isolation is RLS-driven — 00037a0
