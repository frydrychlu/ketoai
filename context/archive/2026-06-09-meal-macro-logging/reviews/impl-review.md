<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Meal Macro Logging (S-01)

- **Plan**: context/changes/meal-macro-logging/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-06-20
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Every planned artifact exists; no MISSING items, no CRITICAL findings. The headline risk (live OpenRouter call from the Worker) is retired. Benign EXTRAs: `extractJsonObject` markdown-fence stripping (macros.ts), and a Profile link on the dashboard from the S-02 health-profile change.

## Findings

### F1 — Client-side fetch-on-mount replaces planned SSR prop-seeding

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/pages/dashboard.astro:36, src/components/meals/MealLogger.tsx:23-51, src/pages/api/meals/index.ts:20-49 (new GET handler)
- **Detail**: Plan Phase 4 specified dashboard.astro builds the SSR client, queries today's meals + total, and passes them as props to `<MealLogger client:load {...} />`. Implementation renders `<MealLogger client:load />` with no props; MealLogger initializes empty and fetches `GET /api/meals?day=<browser-local-date>` on mount. This drove an unplanned GET endpoint. Rationale is sound (server cannot know the browser's local calendar date; `day` is authoritative client input per the plan's own Critical Implementation Details), but it's a real, multi-file departure from the stated contract.
- **Fix A ⭐ Recommended**: Accept and document as a plan addendum.
  - Strength: Preserves working, coherent code; the client-local-date requirement genuinely conflicts with SSR-seeding; the GET handler is the clean way to honor it. Updates the source of truth.
  - Tradeoff: Plan becomes a slightly moving target; GET endpoint is now public API surface the original scope didn't enumerate.
  - Confidence: HIGH — divergence is internally consistent across all three files and matches the plan's day-resolution rule.
  - Blind spot: First paint shows a brief empty state before the mount fetch resolves (minor UX); "zeros when empty" timing not verified.
- **Fix B**: Refactor to SSR prop-seeding as planned.
  - Strength: Restores literal plan adherence; faster first paint.
  - Tradeoff: Server "today" can disagree with the browser's local date across timezones — reintroduces the exact bug the current design avoids; throws away working code.
  - Confidence: MEDIUM — would need a date-reconciliation step the plan hand-waved.
  - Blind spot: Reconciliation flicker if server and client dates differ.
- **Decision**: FIXED via Fix A — plan addendum added (2026-06-20)

### F2 — `day` regex accepts impossible dates → wasted LLM call then 500

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/meals/index.ts:11
- **Detail**: `daySchema = /^\d{4}-\d{2}-\d{2}$/` matches structurally-valid but non-existent dates like "2026-13-45". In POST this passes Zod, the OpenRouter call runs (latency + cost), then the `date`-column insert fails → generic 500 "Could not save meal" (index.ts:99). In GET the same string reaches `.eq("day", ...)` → Postgres cast error → 500 (index.ts:43-44). Since `day` is client-supplied, a malformed value shouldn't reach the model or the DB.
- **Fix**: Tighten daySchema to a true calendar-date check (Zod 4 `z.iso.date()`, or refine by constructing a Date and comparing back to the string), and validate before calling parseMealToMacros.
- **Decision**: FIXED — added `.refine()` round-trip date check to shared daySchema (2026-06-20)

### F3 — `npm run lint` fails: 521 CRLF prettier errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: repo-wide (working tree EOL)
- **Detail**: The Phase 1–4 automated criterion "npm run lint passes" does NOT pass: 521 errors, every one a `Delete ␍` prettier/prettier (CRLF) error, zero substantive code errors. This is the documented autocrlf=true + Prettier-LF friction (the recent .gitattributes eol=lf commit hasn't normalized the working tree). Not introduced by this change's logic, but the gate is red. Build/sync not re-run during review: dev server is live on :4321 and astro build/sync would corrupt the Vite cache; both were recorded green at each phase commit.
- **Fix**: `npm run lint:fix` to normalize EOL, then restore any EOL-only-touched files per the project's known CRLF workflow; confirm lint is clean.
- **Decision**: FIXED — ran lint:fix; only this change's 7 files needed LF normalization; `npm run lint` now clean (2026-06-20)

### F4 — macroResultSchema does not enforce `.finite()`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/macro-schema.ts:11-16
- **Detail**: Contract required finite, non-negative numbers. Fields are `z.number().min(0)` — rejects NaN but not Infinity, so a model returning Infinity could be persisted.
- **Fix**: Add `.finite()` to each macro field.
- **Decision**: SKIPPED — low risk; min(0) already blocks NaN, Infinity is implausible from the model (2026-06-20)

### F5 — Missing API key surfaces to the user as a 422 "parse failure"

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/lib/services/macros.ts:42-44 → src/pages/api/meals/index.ts:82-87
- **Detail**: An unconfigured OPENROUTER_API_KEY throws MacroParseError, mapped to 422 "describe the meal differently". A config fault is shown as bad user input with no distinct server signal. Message leaks nothing — only the misclassification is the issue.
- **Fix**: Use a distinct error type (or 500) for the unconfigured-key case.
- **Decision**: SKIPPED — config fault only occurs if the deploy secret is missing; acceptable at MVP (2026-06-20)

### F6 — DELETE `?day=` query-param contract replaced by deriving day from row

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/meals/[id].ts:30-37, src/components/meals/MealLogger.tsx:82
- **Detail**: Plan said the delete endpoint accepts `day` as a query param; impl reads `deleted.day` via `.delete().select().single()` and the client omits `?day=`. Arguably better (one fewer trust point), internally consistent, but diverges from the contract.
- **Fix**: None needed — note the deviation; optionally update the plan text.
- **Decision**: ACCEPTED — conscious choice; documented in plan Addenda (2026-06-20)

### F7 — MacroBreakdown uses snake_case, not the camelCase the contract showed

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/types.ts:9-14
- **Detail**: Contract example said `{fatG; proteinG; carbsG; caloriesKcal}`; impl uses `{fat_g; protein_g; carbs_g; calories_kcal}` to align with DB columns and avoid a translation layer. The contract was self-contradictory ("align with DB columns" vs the camelCase example).
- **Fix**: None needed — conscious, DB-aligned choice; just flag it.
- **Decision**: ACCEPTED — DB-aligned snake_case is intentional (2026-06-20)

### F8 — GET re-queries the same rows it already holds, just to sum them

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Performance
- **Location**: src/pages/api/meals/index.ts:36-47 → src/lib/services/meals.ts:11-16
- **Detail**: GET `select("*")` already returns the macro columns, then calls getDailyTotal which re-queries the same day's rows. Could sum in JS from the fetched rows, halving round-trips on the mount path. POST/DELETE legitimately need the separate query.
- **Fix**: Compute the total in JS from the already-fetched meals in GET.
- **Decision**: FIXED — extracted pure `sumDailyTotal`; GET now sums fetched rows, no 2nd query (2026-06-20)

### F9 — Retry loop has no backoff and retries non-retryable failures

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/lib/services/macros.ts:48-54
- **Detail**: Retries on every thrown error including 401/400 (guaranteed to fail again) and 429 (immediate retry can worsen rate-limiting), with no delay. Low impact at MVP scale.
- **Fix**: Retry only on 5xx/network/parse errors; add a short delay.
- **Decision**: FIXED — added OpenRouterError.retryable (4xx fails fast) + 300ms delay before retry (2026-06-20)

### F10 — No DB-level non-negative guard on macro columns

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260615182411_meals.sql:20-23
- **Detail**: fat_g/protein_g/carbs_g/calories_kcal are bare `numeric not null`. Zod enforces min(0) at the boundary, but the table accepts negative values from any future writer. Defense-in-depth only (no real overflow risk from numeric).
- **Fix**: Optional — add `check (fat_g >= 0 and ...)` constraints in a follow-up migration.
- **Decision**: FIXED — added migration 20260620075537_meals_macro_nonneg.sql (4 CHECK constraints); applied + verified locally (2026-06-20)
