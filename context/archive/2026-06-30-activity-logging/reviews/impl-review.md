<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Physical Activity Logging with Estimated Calories (S-04)

- **Plan**: context/changes/activity-logging/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-07-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Evidence

- **Automated verification**: repo-wide `npx astro sync && npm run lint` → exit 0 and `astro build` → `Complete!` (run during the S-02 review on the same tree; covers this code). Matches plan Progress SHAs 58432cf / f0715d3 / bb800d1.
- **Migration** (`supabase/migrations/20260630120000_activities.sql`): copies `meals` minus the macro columns — `description text not null`, `calories_kcal numeric not null check (calories_kcal >= 0)`, `day date not null`, `logged_at`, a NON-unique `activities_user_id_day_idx (user_id, day)` (many-per-day), and the canary RLS pattern verbatim (four granular `to authenticated` policies).
- **Estimator** (`src/lib/services/activity-estimate.ts`): a faithful twin of `macros.ts` — same `ENDPOINT`/`MODEL`, `temperature: 0`, `response_format` structured JSON, one-attempt+one-retry loop retrying only transient 5xx via the private `OpenRouterError { retryable }`, `extractJsonObject` defensive parse, and a dedicated `ActivityEstimateError`. Polish activity system prompt returning a single `calories_kcal`. Schema twin `activity-estimate-schema.ts` = `z.object({ calories_kcal: z.number().min(0) })` + strict JSON schema.
- **Service** (`src/lib/services/activities.ts`): pure `sumDailyExpenditure` + `getDailyExpenditure` (single-column SELECT filtered by day, RLS-scoped).
- **API routes**: `index.ts` GET returns the day's activities ordered by `logged_at` + summed total; POST validates → `estimateActivityCalories` (catch `ActivityEstimateError` → 422 Polish message) → insert with `user_id` from the session → returns `{ activity, total }` 201. `[id].ts` DELETE UUID-validates the param, deletes (RLS-scoped, 404 on no row), recomputes and returns the day's total. 401/500 guards on all handlers.
- **Island** (`src/components/activities/ActivityLogger.tsx`): mirrors `MealLogger` — `localDay()`, mount fetch with `AbortController`, `Szacuję…` busy state, append-on-success, per-row `Trash2` delete, daily total + each row visibly labeled approximate ("~N kcal", "estimate", "(approximate)").
- **Types** (`src/types.ts`): `Activity`, `CreateActivityCommand` (no `calories_kcal`), `DailyExpenditureTotal` match the migration. Dashboard mounts `<ActivityLogger client:load />` under an "Activity" heading. RLS proof recipe present (`supabase/tests/activities_rls.sql`).

## Findings

### F1 — Plan bookkeeping doesn't reflect shipped reality

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/activity-logging/plan.md:432 + change.md:4
- **Detail**: Same drift as S-03: all Manual verification checkboxes are `- [ ]` and change.md said `status: planned`, yet the feature is fully implemented, committed (58432cf/f0715d3/bb800d1), and merged. The Phase-1 DB/RLS automated checks (1.1–1.3) are unchecked because they need the Docker DB. Record drift, not missing work.
- **Fix**: Reconcile the record — this review bumps change.md to `impl_reviewed`; optionally tick the evidenced manual items.
- **Decision**: PENDING

### F2 — Failed DELETE is swallowed silently in the island

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/activities/ActivityLogger.tsx:79
- **Detail**: `remove()` returns silently on a non-OK DELETE (`if (!res.ok) return;`) and on a network error — no inline error, no pending guard, unlike `submit()` which surfaces `data.error`. A failed delete leaves the row on screen with no feedback. Likely mirrors MealLogger's delete (not fully confirmed), so it may be intentional pattern-consistency rather than a defect.
- **Fix**: Surface an inline error on delete failure if parity with `submit()` is wanted; otherwise accept as matching the meals island.
- **Decision**: PENDING
