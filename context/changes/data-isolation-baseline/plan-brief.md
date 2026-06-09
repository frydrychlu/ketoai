# Data Isolation Baseline (F-01) — Plan Brief

> Full plan: `context/changes/data-isolation-baseline/plan.md`

## What & Why

Establish the per-user data-isolation contract every later KetoAI table depends on: a repeatable,
version-controlled Supabase migration workflow against the cloud project, plus a proven RLS pattern
that keeps one authenticated user's rows invisible to another. RLS is the stack's named-risk gap, and a
mis-set policy silently leaks personal health data — so it's proven once, here, before any feature table
exists.

## Starting Point

The isolation mechanism is structurally wired but unused: the SSR client (`src/lib/supabase.ts`) runs
every query as the logged-in user via anon key + cookies, so `auth.uid()`-based RLS is the right
enforcement layer — but there are no tables, no `supabase/migrations/` directory, and no policies. The
user runs cloud-only Supabase (no local Docker) and can create/log in users there.

## Desired End State

A first migration creates a minimal `isolation_canary` table (live in cloud via `supabase db push`)
with RLS and four granular per-op policies; a committed SQL impersonation script proves user B sees only
B's rows; and `AGENTS.md` documents the canonical pattern for every later table to copy.

## Key Decisions Made

| Decision                  | Choice                                   | Why (1 sentence)                                                              | Source |
| ------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Migration delivery        | CLI `supabase link` + `db push` to cloud | Version-controlled files in git, repeatable, no Docker — the workflow F-01 exists to prove | Plan   |
| What to prove RLS on       | Minimal `isolation_canary` table         | Honors "no domain tables" while giving a real table to verify + a copy template | Plan   |
| Ownership convention      | Direct FK `user_id → auth.users(id)`     | Simplest standard Supabase pattern; cascades cleanly on account delete         | Plan   |
| Verification mechanism    | SQL impersonation script                 | Repeatable, no test tooling, UI-independent, re-usable for every future table   | Plan   |
| Template scope            | RLS policies only (minimal)              | User chose lean; no timestamp/trigger/grant scaffolding baked in now            | Plan   |
| Pattern docs home         | Append section to `AGENTS.md`            | One file, already the agent's first read; no new docs/reference tree            | Plan   |
| Proof depth               | SELECT isolation only                    | User chose lean; write-side policies exist but aren't formally asserted         | Plan   |

## Scope

**In scope:** one canary migration (table + RLS + 4 policies), one-time CLI link to cloud, a SQL
isolation-verification script, and an AGENTS.md pattern section.

**Out of scope:** domain feature tables (meals/biomarkers/profile/etc.), timestamp/trigger/grant
scaffolding, `public.profiles` mirror + signup trigger, `docs/reference/` tree, any test framework, CI
gating, app UI, and write-side (INSERT/UPDATE/DELETE) isolation assertions.

## Architecture / Approach

Author `supabase/migrations/<ts>_isolation_canary.sql` → `supabase link --project-ref <ref>` (one-time)
→ `supabase db push` applies it to cloud (proves the workflow + lands RLS). Then a transaction-based SQL
script sets `role authenticated` + `request.jwt.claims` to impersonate two real users and asserts SELECT
isolation. Migrations are forward-only.

## Phases at a Glance

| Phase                                      | What it delivers                                              | Key risk                                                            |
| ------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1. Migration workflow + canary w/ RLS      | Versioned migration applied to cloud; table live with RLS + 4 policies | Interactive `supabase link` (project ref + DB password) is a human step |
| 2. Isolation verification + AGENTS.md docs | SQL proof that B can't see A's rows; pattern documented        | SQL editor bypasses RLS unless the script switches role + sets JWT claims |

**Prerequisites:** a cloud Supabase project, its project ref + DB password (for `supabase link`), and
the ability to create two users for the proof. `wrangler`/`supabase` CLIs are already in devDependencies.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- **Write-side isolation is defined but not asserted.** INSERT/UPDATE/DELETE policies exist (and INSERT
  is exercised while seeding), but only SELECT isolation is formally proven. The first real table
  (meals, S-01) should re-run an INSERT/UPDATE/DELETE `WITH CHECK` check — the classic RLS footgun.
- **SQL-editor RLS bypass.** If the verification script forgets `set local role authenticated` + JWT
  claims, it will appear to pass while actually bypassing RLS. The script must run inside a transaction
  that switches role (called out in the plan).
- **Minimal template means later drift.** Without baked-in timestamp/trigger/grant conventions, later
  tables may diverge; acceptable per the lean choice, but worth watching.
- Assumes the cloud DB password is available for the one-time link.

## Success Criteria (Summary)

- A version-controlled migration is applied to cloud via `supabase db push`; `isolation_canary` is live
  with RLS on and 4 policies.
- The impersonation script demonstrates user B sees only B's rows (and the unrestricted query shows
  both — confirming the isolation is RLS, not missing data).
- `AGENTS.md` documents the reusable RLS + migration pattern for later slices.
