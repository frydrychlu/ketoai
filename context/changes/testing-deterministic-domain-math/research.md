---
date: 2026-08-06T15:23:30+0000
researcher: Claude (10x-research)
git_commit: ee8041c9e21ec2b9c9037d6945b6214155835f30
branch: main
repository: frydrychlu/ketoai
topic: "Ground rollout Phase 2 (Deterministic domain math) — Risk #4 boundary correctness"
tags: [research, codebase, biomarkers, meals, gki, daily-totals, pagination, testing-deterministic-domain-math]
status: complete
last_updated: 2026-08-06
last_updated_by: Claude (10x-research)
---

# Research: Deterministic domain math boundaries (Risk #4) — GKI and daily macro totals

**Date**: 2026-08-06T15:23:30+0000
**Researcher**: Claude (10x-research)
**Git Commit**: ee8041c9e21ec2b9c9037d6945b6214155835f30
**Branch**: main
**Repository**: frydrychlu/ketoai

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` (Risk #4: "A daily macro total or GKI value is plausible but wrong at a boundary — zero ketones, a day with no entries, or an entry landing on the wrong calendar day"). Verify or correct the Risk Response Guidance for #4, locate existing tests, identify the cheapest useful test layer, and separately verify the carried-over Phase 1 lead about `max_rows = 1000` silent truncation in `listDailyTotals`/`listDailyExpenditure`.

## Summary

**Risk #4 — three boundaries, all groundable, none currently tested:**

1. **Zero ketones (GKI div-by-zero).** `computeGki` (`src/lib/services/biomarkers.ts:13-15`) is a one-line, unguarded `glucoseMgDl / 18 / ketonesMmolL` — it will silently return `Infinity` if ever called with `ketonesMmolL = 0`. The guard against this is entirely *upstream* of the function: Zod `min(0.1)` on the API route (`src/pages/api/biomarkers/index.ts:25`) plus a DB `CHECK (ketones_mmol_l > 0)` (`supabase/migrations/20260630120001_biomarker_readings.sql:35`). This was a deliberate design decision from `context/archive/2026-06-30-biomarker-gki-logging/plan.md` — not an open question — but it has **zero test coverage** anywhere in `tests/`. No file exists for `biomarkers.ts` or the biomarkers route.

2. **A day with no entries.** Two different, inconsistent zero-day behaviors exist in the same service layer, both untested:
   - Single-day (`getDailyTotal`, `meals.ts:25-37`): returns a zero-filled `{fat_g:0, protein_g:0, carbs_g:0, calories_kcal:0}` object — reduce's initial accumulator falls through on an empty array.
   - Range (`listDailyTotals`, `meals.ts:49-79`): empty days are **omitted entirely** from the result array — documented behavior ("Only days that have meals appear (no zero rows)"), not a bug, but a real asymmetry a boundary test should pin down explicitly since a naive caller could assume the range function zero-fills like the single-day one does.

3. **Calendar-day boundary.** Not server/DB-derived at all — it's a client-supplied `YYYY-MM-DD` string, matched by exact equality (`meals.ts:29`, `.eq("day", day)`) or lexicographic range (`meals.ts:57-58`, `.gte/.lte`), stored in a plain `date` column. There is a separate `logged_at timestamptz` column used only for ordering, never for day derivation. This is a deliberate, repeatedly-documented convention across three archived features (meals, activities, biomarkers) — "the browser supplies the local date, not derived from UTC `now()`" — specifically to avoid midnight-boundary misclassification. Because the boundary decision is pushed entirely to the client and trusted verbatim, the correct **unit-testable boundary is `daySchema`'s calendar validity check** (rejects `2026-02-30`-shaped strings), not a timezone-conversion function — there is no timezone conversion code in this repo to test. This is an important correction to the response-guidance framing (see below).

**Cheapest layer for all three: unit tests on pure functions** — `computeGki`, `sumDailyTotal`, and `daySchema` are all pure/schema-level and require no DB or network. This matches test-plan.md's own §3 Phase 2 test-type assignment (`unit`) and §6.1 cookbook precedent (Atwater formula as a "domain law computed independently of the implementation" exception).

**The `max_rows = 1000` lead does NOT belong in Phase 2's scope**, despite currently sitting in Risk #4's Source column. It is confirmed real and, if anything, worse than framed — but it is a *data-completeness/infrastructure* defect (PostgREST silently truncating a fetch before any domain math runs), not a *domain-math boundary* defect (the math is correct on whatever rows it receives). See "Post-research backport correction" below.

## Detailed Findings

### GKI calculation and the zero-ketone boundary

- **Formula**: `src/lib/services/biomarkers.ts:13-15`
  ```ts
  export function computeGki(glucoseMgDl: number, ketonesMmolL: number): number {
    return glucoseMgDl / 18 / ketonesMmolL;
  }
  ```
  Matches PRD Business Logic rule 1 exactly (`context/foundation/prd.md:119`): `GKI = (blood glucose in mg/dL ÷ 18) ÷ blood ketones in mmol/L`.

- **No internal guard.** The function's own doc comment (`biomarkers.ts:8-11`) states the precondition explicitly: *"Assumes `ketonesMmolL > 0`; that precondition is enforced upstream ..., not inside this function, so it never divides by zero."* Called directly with `ketonesMmolL = 0`, it returns `Infinity` (not `NaN`, not a throw) — glucose is never 0 in practice (Zod `min(20)`), so `0/0` doesn't arise via this path.

- **Upstream guard, two independent layers:**
  - Zod: `src/pages/api/biomarkers/index.ts:20-27` — `ketones_mmol_l: z.number().min(0.1).max(20)`. The `0.1` floor is *stricter* than the DB constraint — a hypothetical `ketonesMmolL = 0.05` would pass the DB CHECK but fail Zod.
  - DB: `supabase/migrations/20260630120001_biomarker_readings.sql:35` — `check (ketones_mmol_l > 0 and ketones_mmol_l <= 20)`.
  - Glucose is bounded independently: Zod `z.number().int().min(20).max(600)` (`biomarkers/index.ts:26`), DB `check (glucose_mg_dl between 20 and 600)` (migration line 36).

- **GKI is computed once, on write, and stored** — not recomputed on read. `upsertReading` (`biomarkers.ts:71-98`) calls `computeGki` and persists the result into `gki numeric not null` (migration line 31). `getReading`/`listReadings` just select the stored column. Confirmed by `src/types.ts:106`: `/** Glycemic-ketone index, computed server-side and stored. */`.

- **Unrounded vs. seed data**: `computeGki` returns the raw unrounded float (doc comment: "Pure and unrounded — the caller/display layer rounds"), while `supabase/seeds/history_seed.sql:135` and `supabase/seeds/biomarker_trends_seed.sql:70` round to 3 decimals (`round((s.glucose / 18.0) / s.ketones, 3)`). Not a defect — seeds are synthetic fixture data, not app code — but a test must compute its own expected value from `glucose/18/ketones` unrounded, never copy a seed's rounded value.

- **Design history**: `context/archive/2026-06-30-biomarker-gki-logging/plan.md:70-72, 151-155, 203` confirms the div-by-zero guard was a deliberate 2026-06-30 design decision, verified once by hand ("Direct insert of `ketones_mmol_l = 0` rejected by CHECK") — but never captured as an automated test.

- **Test coverage: none.** No `tests/services/biomarkers.test.ts` or `tests/api/biomarkers.test.ts` exists. The only appearance of `biomarker_readings` in `tests/` is `tests/api/analysis.test.ts`, which stubs it as an *empty* PostgREST response for an unrelated endpoint — it never exercises `computeGki` or ketones=0. (`supabase/tests/biomarker_readings_rls.sql` hand-computes GKI values for RLS isolation checks, but that's a SQL RLS recipe under `supabase/tests/`, testing access control, not the formula or its edges — and it never tries ketones=0.)

### Daily macro aggregation and the calendar-day boundary

- **Pure summation**: `src/lib/services/meals.ts:8-18`
  ```ts
  export function sumDailyTotal(rows: MacroRow[]): DailyMacroTotal {
    return rows.reduce<DailyMacroTotal>(
      (acc, row) => ({
        fat_g: acc.fat_g + row.fat_g,
        protein_g: acc.protein_g + row.protein_g,
        carbs_g: acc.carbs_g + row.carbs_g,
        calories_kcal: acc.calories_kcal + row.calories_kcal,
      }),
      { fat_g: 0, protein_g: 0, carbs_g: 0, calories_kcal: 0 },
    );
  }
  ```
  Matches PRD Business Logic rule 2 (`prd.md:121`): "the daily macro summary is the arithmetic sum of all meal entries for that calendar day."

- **Two callers, two zero-day behaviors:**
  - `getDailyTotal` (`meals.ts:25-37`, single day, `.eq("day", day)`) → empty `data` array → `sumDailyTotal([])` → the zero-filled accumulator, returned as-is. Also reached directly from the route (`src/pages/api/meals/index.ts:94`, GET single-day branch).
  - `listDailyTotals` (`meals.ts:49-79`, range, `.gte/.lte`) → rows are grouped into a `Map<day, rows[]>` (lines 68-76) and folded per day (line 78) → **days with zero meals produce no entry at all** in the output array. Documented at `meals.ts:43-44` and `src/types.ts:40`: "Only days that have meals appear — there are no zero rows."

- **Calendar-day boundary is decided entirely client-side, never re-derived server-side.** `supabase/migrations/20260615182411_meals.sql:12-13`:
  ```sql
  --   day           the client-reported LOCAL calendar date this meal counts toward (not derived
  --                 from UTC now() — the browser supplies it so the daily total groups correctly)
  ```
  The `day` column is a plain Postgres `date`, filtered by string equality/range (`meals.ts:29`, `:57-58`), never compared against `logged_at timestamptz` (which exists only for in-day ordering — `meals.ts` query `.order("logged_at", { ascending: true })` at `src/pages/api/meals/index.ts:86`). The client computes and sends the date string; the server trusts it verbatim (`src/pages/api/meals/index.ts:10-12` documents the malformed-date guard: `daySchema`'s `.refine()` round-trip check rejects structurally-valid-but-nonexistent dates like `2026-02-30` before the value reaches the `date` column).
  - This convention is repeated identically for activities (`context/archive/2026-06-30-activity-logging/plan.md:126-128`) and biomarkers (`context/archive/2026-06-30-biomarker-gki-logging/plan.md:150`), and the `localDay()` client helper is deliberately *not* extracted into a shared module (`context/archive/2026-07-01-biomarker-trend-dashboard/plan.md:39, 233` — "do NOT extract" convention), a recorded pattern, not an oversight.
  - **Correction to the Risk Response Guidance's framing** (test-plan.md line 44: "what happens when the divisor is zero; whether aggregation reads a calendar day or a rolling 24-hour span"): there is no rolling-24-hour-span code path anywhere in this codebase to test against — aggregation is always a `date`-column comparison, never a `timestamptz` window. The real day-boundary risk here isn't "24h span vs calendar day" (that's not implemented either way as a live ambiguity) — it's **whether `daySchema` correctly rejects invalid calendar dates before they reach the `date` column**, since that's the only validation standing between "arbitrary client string" and "day the totals get grouped under." `daySchema` itself was already hardened once for exactly this reason (`context/archive/2026-06-09-meal-macro-logging/reviews/impl-review.md:50-52`, fixed 2026-06-20) — but that fix has no dedicated boundary test pinning the round-trip refinement (e.g. `2026-02-30` correctly rejected, `2026-02-28` / leap-year `2026-02-29`-shaped edges correctly accepted/rejected).

- **Test coverage: none.** `tests/api/meals.test.ts` has one test, covering only the POST Atwater-guard rejection path (Risk #1) — it never calls GET, never touches `sumDailyTotal`/`getDailyTotal`/`listDailyTotals`, empty-day, or day-boundary behavior. No `tests/services/meals.test.ts` exists.

### `max_rows = 1000` pagination lead — confirmed, but out of Phase 2's scope

- **Config**: `supabase/config.toml:18`, under `[api]`: `max_rows = 1000` — this is PostgREST's row cap; a response over the limit is silently truncated with no error and no count.
- **No pagination anywhere.** `listDailyTotals` (`meals.ts:49-64`) and `listDailyExpenditure` (`src/lib/services/activities.ts:43-58`) both fetch with `.gte()/.lte()` and no `.range()`/`.limit()`. A repo-wide search for `.range(`/`.limit(` under `src/` returns zero matches.
- **Confirmed live callers**: the trends dashboard (`src/components/biomarkers/BiomarkerTrends.tsx:118-122`, via `GET /api/meals`/`GET /api/activities` range branches) and the FR-012 analysis prompt (`src/lib/services/analysis.ts:45-46`, `gatherAnalysisWindow`, called from the analysis route with `window_days ∈ {7,14,30}`).
- **Sharper than the original framing.** The "~33 meals/day over 30 days" framing holds for the shipped UI (`BiomarkerTrends.tsx` caps its range picker at 30 days: `RANGES = [7,14,30]`). But the API route itself allows up to `MAX_RANGE_DAYS = 366` (`src/pages/api/meals/index.ts:29`, `src/pages/api/activities/index.ts:29`) for any authenticated caller — over a full year, only **~2.7 meals/day** would trigger silent truncation, a materially more realistic threshold than "~33/day" for any client that queries the API directly (or a future UI change widening the range picker).
- **Why this doesn't belong in Phase 2.** Risk #4 as scoped is about the *domain math* being wrong at a boundary — the arithmetic itself. This defect sits one layer upstream: the math (`sumDailyTotal`) is correct on whatever rows it's given; the rows themselves are silently incomplete before the math ever runs. It also corrupts the AI analysis's own confidence signal — `gatherAnalysisWindow`'s `coverage.mealDays` (`src/lib/services/analysis.ts:53-59`) is computed from the already-truncated `meals.length`, so FR-012's sparse-window hedging (Risk #6, Phase 5) would hedge confidently on a lie. This makes it a **distinct data-completeness/silent-truncation risk**, with tendrils into both Risk #4 (shares the same service files) and Risk #6 (corrupts the hedging signal), but it is not itself a "wrong at a boundary" math defect — it's a "wrong dataset before the boundary" defect. **No unit test can catch it** (unit tests don't exercise the real PostgREST layer) — it would need an integration-level test with a real (or realistically stubbed) row cap, which is a different cost/signal tier than Phase 2's `unit` assignment.
- **No test coverage** exists for this anywhere in `tests/`.

## Code References

- `src/lib/services/biomarkers.ts:13-15` — `computeGki`, unguarded formula
- `src/lib/services/biomarkers.ts:71-98` — `upsertReading`, computes + persists GKI on write
- `src/pages/api/biomarkers/index.ts:20-27` — Zod `ketones_mmol_l: min(0.1).max(20)`, div-by-zero guard
- `supabase/migrations/20260630120001_biomarker_readings.sql:30-36` — DB `CHECK` constraints on ketones/glucose, `gki numeric not null`
- `src/lib/services/meals.ts:8-18` — `sumDailyTotal`, pure aggregation
- `src/lib/services/meals.ts:25-37` — `getDailyTotal`, single-day, zero-fills on empty
- `src/lib/services/meals.ts:49-79` — `listDailyTotals`, range, omits empty days
- `supabase/migrations/20260615182411_meals.sql:12-13,24` — `day date not null`, client-local-date design comment
- `src/pages/api/meals/index.ts:10-12` — `daySchema` malformed-date guard comment
- `src/pages/api/meals/index.ts:29` / `src/pages/api/activities/index.ts:29` — `MAX_RANGE_DAYS = 366`
- `supabase/config.toml:18` — `max_rows = 1000`
- `src/lib/services/activities.ts:43-58` — `listDailyExpenditure`, unpaginated
- `src/lib/services/analysis.ts:45-59` — `gatherAnalysisWindow`, consumes both range functions; `coverage.mealDays` computed post-truncation
- `src/components/biomarkers/BiomarkerTrends.tsx:34-36,118-122` — sole UI caller of the range endpoints, `RANGES = [7,14,30]`
- `tests/services/macros.test.ts` — Phase 1 precedent for describe/it structure and file placement convention

## Architecture Insights

- **Client-owns-the-day is a deliberate, repeated cross-feature convention**, not an accident — meals, activities, and biomarkers all store a client-supplied `date` and never derive it from a server timestamp. This eliminates the "24-hour rolling window vs. calendar day" ambiguity the original risk wording anticipated; the real remaining risk is validation of the date *string itself* (`daySchema`), not a timezone-conversion bug.
- **Defense-in-depth is the house style for numeric boundaries**: every numeric floor/ceiling this research touched (ketones, glucose) is enforced at both Zod and DB-CHECK layers, generally with Zod stricter than or equal to the DB. This mirrors the pattern already noted for Risk #1's AI-derived ceilings in Phase 1.
- **Two aggregation functions in the same file disagree on empty-day representation** (`getDailyTotal` zero-fills, `listDailyTotals` omits) — both are intentional per their doc comments, not a bug, but exactly the kind of asymmetry a boundary test should pin explicitly so a future refactor can't silently unify them the wrong way.
- **A defect can be real, well-evidenced, and still not belong to the phase that surfaces it.** The `max_rows` truncation lives in the same files as Risk #4's aggregation logic but fails on a different axis (completeness of input, not correctness of arithmetic) and needs a different test layer (integration, not unit) — cost×signal reasoning (test-plan.md §1 principle #1) argues for keeping it out of Phase 2 rather than inflating this phase's scope to cover it cheaply and badly.

## Historical Context (from prior changes)

- `context/archive/2026-06-30-biomarker-gki-logging/plan.md:70-72,151-155,203` — original design and one-time manual verification of the GKI div-by-zero guard (2026-06-30). Never converted to an automated test.
- `context/archive/2026-07-01-biomarker-trend-dashboard/plan.md:17-18` — downstream confirmation that every stored GKI row is valid, no null-GKI gaps.
- `context/archive/2026-06-09-meal-macro-logging/plan.md:35,79,240,250` — original client-local-date convention for meals.
- `context/archive/2026-06-30-activity-logging/plan.md:126-128` — same convention repeated for activities, calling out "identical to the meals `day` contract."
- `context/archive/2026-06-09-meal-macro-logging/reviews/impl-review.md:50-52` — `daySchema` hardened (2026-06-20) to reject structurally-valid-but-nonexistent dates via a round-trip `.refine()`; no dedicated test exists for this fix today.
- `context/changes/testing-runner-bootstrap-ai-boundary/research.md:329,414` — origin of the `max_rows = 1000` finding (risk #7 research pass, Q8), explicitly recommended for backport to Risk #4 rather than action in Phase 1.
- `context/changes/testing-runner-bootstrap-ai-boundary/plan.md:54,396` — Phase 1 explicitly declined to fix the truncation, deferring to `--refresh`.
- `context/foundation/test-plan.md` row 30 (Risk #4 Source) — confirms the Q8 finding **was already backported** into the risk map on 2026-08-06, contradicting this change's own `change.md`, which still says "not yet backported to the risk map" (see correction below).

## Post-research backport correction (flag for `/10x-test-plan`)

Per the test-plan skill's post-research backport check, this research surfaced a correction to §2 worth a decision before planning proceeds:

- **`change.md` is stale.** It states the `max_rows` lead is "not yet backported to the risk map," but `test-plan.md` row 30 (Risk #4 Source column) already carries it, dated 2026-08-06. Harmless, but worth fixing so a future reader isn't confused about state.
- **Scope correction, not just a staleness fix.** The lead is currently filed *under* Risk #4's Source, which reads as "this is part of what Phase 2 should test." It isn't, on the evidence above: it's a data-completeness defect one layer upstream of the domain math, needs an integration-level test (not unit), and is materially worse than framed (~2.7 meals/day over the API's real 366-day range cap, not ~33/day). Recommend either (a) promoting it to its own risk-map row at the next `--refresh`, scored on its own impact/likelihood, or (b) at minimum correcting Risk #4's Source note to make explicit that it's adjacent evidence, not in Phase 2's test scope, and correcting the "~33 meals/day" figure to reflect the 366-day API bound.

This does not block Phase 2 planning — the three domain-math boundaries (zero ketones, empty day, `daySchema` validity) are independently well-grounded and sufmore than enough to plan against. It's a parallel finding that belongs to `/10x-test-plan`, not this phase's plan.

## Related Research

- `context/changes/testing-runner-bootstrap-ai-boundary/research.md` — Phase 1 research; source of the `max_rows` lead (Q8) and the general validation-asymmetry pattern (Risk #1)
- `context/changes/testing-runner-bootstrap-ai-boundary/plan.md` — Phase 1 plan; §6.1/§6.6 cookbook conventions this phase's tests should follow

## Open Questions

- Should the `max_rows` truncation be promoted to its own risk-map row, or folded into Risk #4's Source with corrected framing? (Flagged above for `/10x-test-plan`, not resolved here.)
- The NaN/Infinity-via-direct-PostgREST-PATCH note from Phase 1 research (`testing-runner-bootstrap-ai-boundary/research.md:125-126` — Postgres accepts `'NaN'::numeric`/`'Infinity'::numeric` past a live `*_update_own` RLS policy) was never assigned to a phase. It's adjacent to Risk #4 (a NaN glucose/ketone value reaching `computeGki` is a boundary case) but reaches the database via a path this phase's unit tests cannot exercise (it bypasses the Zod route entirely via direct PostgREST access). Worth a decision on whether it's in scope for Phase 2, deferred to Phase 3 (isolation/RLS, since it's really an RLS-policy-surface question), or left unassigned.
