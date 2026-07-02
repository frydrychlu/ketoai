<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Health Profile (S-02)

- **Plan**: context/changes/health-profile/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-07-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

- **Automated verification**: `npx astro sync && npm run lint` → exit 0 (only benign `astro-eslint-parser projectService` notices); `astro build` → `Complete!` (the `file` CSS-property and sitemap `site` warnings are pre-existing and unrelated to this slice).
- **Migration** (`supabase/migrations/20260617072330_health_profiles.sql`): copies the `isolation_canary` pattern verbatim — `user_id uuid not null references auth.users on delete cascade`, `enable row level security`, four granular `to authenticated` policies keyed on `auth.uid() = user_id` (writes with `with check`), plus the `unique (user_id)` singleton constraint and nullable columns with `CHECK` guards that pass on NULL (partial saves allowed). Filename sorts after `20260615182411_meals`.
- **Service** (`src/lib/services/profile.ts`): `upsertProfile` lists all five columns explicitly (value-or-null) so cleared fields are NULLed on the conflict-UPDATE path — the plan's load-bearing Critical Implementation Detail. `updated_at` set explicitly. `getProfile` uses `.maybeSingle()` for the no-row case.
- **API route** (`src/pages/api/profile/index.ts`): `prerender = false`; `user_id` always from `context.locals.user.id` (never client-supplied); empty→null coercion before a fully-nullable Zod schema; range bounds and the `ACTIVITY_LEVELS` enum mirror the DB CHECKs; auth-style error/success redirects.
- **Form** (`src/components/profile/ProfileForm.tsx`): native `method="POST"` to `/api/profile`, reuses auth `FormField`/`SubmitButton`/`ServerError` primitives, client-side range validation blocks submit so the lossy server redirect is only a backstop.
- **SSR page** (`src/pages/profile.astro`): reads the row via `getProfile` (no separate GET endpoint, as planned), surfaces `saved`/`error` flash, degrades to an empty form on read error.
- **Route protection**: `/profile` added to `PROTECTED_ROUTES` in `src/middleware.ts`. Dashboard link present. Shared types added to `src/types.ts`. RLS proof recipe present (`supabase/tests/health_profiles_rls.sql`).

## Findings

### F1 — health_goals has no maximum length

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/profile/index.ts:17
- **Detail**: The DB column is unbounded `text` and the Zod rule is `z.string().min(1).nullable()` — no upper bound, so an arbitrarily large goals string is persisted as-is. The plan explicitly wanted a "freeform text field," so this is likely by-design. At MVP single-user scale the blast radius is nil; flagged only because it's the one input without a cap.
- **Fix**: Add `.max(2000)` (or similar) to the health_goals rule if a guardrail is wanted; otherwise accept as intentional.
- **Decision**: PENDING
