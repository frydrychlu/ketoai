# Deterministic Domain Math (Risk #4) — Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md`. Write unit-level tests that pin three boundary properties in the domain-math layer, all of which are already correctly implemented but have zero automated test coverage today:

1. GKI's zero-ketone precondition (`computeGki`, `src/lib/services/biomarkers.ts`).
2. The intentional empty-day asymmetry in daily aggregation, for both meals and activities.
3. The calendar-date validity gate (`daySchema`) that decides which day an entry counts toward.

This phase writes tests only. No production code changes are required — research (`research.md`) confirmed all three properties are already correctly guarded; the risk is that they are unverified, not that they are wrong.

## Current State Analysis

- `computeGki` (`src/lib/services/biomarkers.ts:13-15`) is a one-line, unguarded `glucoseMgDl / 18 / ketonesMmolL`. Its own doc comment states the zero-guard is enforced entirely upstream: Zod `min(0.1)` (`src/pages/api/biomarkers/index.ts:25`) and a DB `CHECK (ketones_mmol_l > 0)` (`supabase/migrations/20260630120001_biomarker_readings.sql:35`). No test exists for either the formula or the guard.
- `sumDailyTotal` (`src/lib/services/meals.ts:8-18`) zero-fills on an empty row array; `getDailyTotal` (`meals.ts:25-37`) is a thin wrapper with no other logic, so testing `sumDailyTotal([])` fully proves `getDailyTotal`'s empty-day behavior. `listDailyTotals` (`meals.ts:49-79`) instead **omits** days with no rows from its result array — this fold/group logic is embedded inside the async, DB-calling function itself, not separately exported, so proving it requires exercising `listDailyTotals` (via the `GET /api/meals` range branch, MSW-stubbed) rather than a pure-function call.
- `activities.ts` (`src/lib/services/activities.ts`) is a structural twin of `meals.ts`: `sumDailyExpenditure`/`getDailyExpenditure`/`listDailyExpenditure` mirror `sumDailyTotal`/`getDailyTotal`/`listDailyTotals` exactly, including the same empty-day asymmetry. Confirmed in scope for this phase (deliberate widening beyond Risk #4's literal "macro total" wording — same failure shape, same near-zero marginal cost).
- `daySchema` (`src/pages/api/meals/index.ts:13-19`, and near-identical copies in `biomarkers/index.ts`, `activities/index.ts`, `analysis/index.ts`) is a **private, per-route** Zod schema — not exported, not importable. It's reachable only by calling the route's exported `GET`/`POST` handler. This phase tests it once via the meals route (representative copy) per the cost×signal call already made — the four copies are currently byte-identical and the "do NOT extract" convention already accepts copy-drift risk by design.
- Existing test infrastructure (Vitest 4, `environment: "node"`, MSW `setupServer`, `buildApiContext` route harness) is fully sufficient — no new tooling needed. `tests/services/macros.test.ts` (Phase 1) is the direct structural precedent: `describe("<function> — <property> (risk #N)")`, nested `describe` by boundary class, `it("<verb-first behavior>")`.
- `postgrestRows(table, rows)` (`tests/helpers/msw.ts:39-41`) stubs a PostgREST GET for a given table — this is what lets `listDailyTotals`/`listDailyExpenditure` be exercised through the real route without a live Supabase stack.

### Key Discoveries:

- `getDailyTotal`/`getDailyExpenditure` have no logic beyond `sum...(data)` — testing the pure `sum...` function with `[]` is a faithful, complete proof of their empty-day behavior; no route test needed for that half of the asymmetry.
- `listDailyTotals`/`listDailyExpenditure`'s omission behavior is NOT separately extractable without a production refactor — proving it requires the route + MSW, decided over refactoring to keep this phase test-only.
- Route-level `GET` validation for `day`/`from`/`to` runs *before* any Supabase query in every route checked (`meals`, `biomarkers`, `activities`) — an invalid-date request never reaches PostgREST, so a `postgrestTripwire()` on those tests is a belt-and-suspenders assertion, not a requirement for the status-code assertion to be valid.
- 2026 is not a leap year (2026 mod 4 = 2); 2024 is. The leap-day accept/reject pair must use `2024-02-29` (valid) and a non-leap year's `02-29` (invalid) — not `2026-02-29`, which would incorrectly test as a reject case for the wrong reason.
- `ketones_mmol_l`'s Zod floor (`min(0.1)`) is strictly tighter than the DB `CHECK (> 0)` — a value like `0.05` passes the DB constraint but fails Zod. Worth a dedicated reject case distinct from the `0` case.

## Desired End State

`npm test` includes new unit tests, all passing, that:
- Prove `computeGki` matches PRD Business Logic rule 1 at representative points across its valid domain, independently computed.
- Prove a `ketones_mmol_l: 0` (and `0.05`) request is rejected with 400 and persists nothing.
- Prove `sumDailyTotal([])`/`sumDailyExpenditure([])` zero-fill, and that `listDailyTotals`/`listDailyExpenditure` omit an empty day from a range result — both pinned in the same test file, named to make the asymmetry explicit.
- Prove `daySchema`'s round-trip validity check accepts/rejects the documented edge cases via the meals route.

`context/foundation/test-plan.md` §6.6 carries a new Phase 2 cookbook entry. `context/foundation/test-plan.md` §3 Phase 2 row and `change.md` status are updated once implementation lands (owned by `/10x-implement`, not this plan).

### Verification
`npm test` passes with the new files included; `npm run lint` and `npx astro sync && npm run build` remain green (no production code touched, so this is a regression check, not new surface).

## What We're NOT Doing

- No production code changes — all three properties are already correct.
- No fix or test for the `max_rows = 1000` silent-truncation lead — confirmed by research to be a distinct data-completeness risk, not a domain-math boundary defect; deferred to the next `/10x-test-plan --refresh` per user decision this session.
- No test for the NaN/Infinity-via-direct-PostgREST-PATCH gap noted in Phase 1 research — it bypasses the Zod route entirely via RLS-level access, which is an isolation/RLS-surface question, not a unit-testable domain-math boundary. Left unassigned, as research flagged.
- No day-validity boundary tests for the biomarkers/activities/analysis routes' copies of `daySchema` — cost×signal decision: one representative route (meals) covers the shared, currently-identical logic.
- No extraction of `listDailyTotals`/`listDailyExpenditure`'s grouping logic into a separately-exported pure function — proving the omission behavior through the real route is cheaper than a refactor whose only purpose would be enabling a test.
- No integration tests against a live local Supabase stack — Phase 3 (`§3 Isolation and ownership as a gate`) is where the local stack becomes a test dependency; this phase stays hermetic (MSW-stubbed PostgREST, no Docker required).

## Implementation Approach

Group sub-phases by the risk property they prove (GKI, aggregation asymmetry, day validity), not by test layer — each sub-phase states the behavior asserted, the regression it catches, its research source, and the anti-pattern it avoids, per the task's own instruction. Pure-function tests come first within each sub-phase (cheapest, most direct signal); route-level tests follow only where the property genuinely can't be reached any cheaper way. A final sub-phase runs Stryker mutation testing scoped to the touched files and updates the cookbook.

## Phase 1: GKI zero-ketone boundary

### Overview

Proves `computeGki` computes the PRD formula correctly across its valid domain, and that the real request path rejects `ketones_mmol_l = 0` (and the sub-Zod-floor `0.05`) rather than ever computing `Infinity`.

### Changes Required:

#### 1. Pure formula tests

**File**: `tests/services/biomarkers.test.ts` (new)

**Intent**: Prove `computeGki` matches PRD Business Logic rule 1 (`GKI = (glucose_mg_dL ÷ 18) ÷ ketones_mmol_L`) at representative points spanning the valid domain, computed independently from the PRD formula — never by reading `computeGki`'s own output. Behavior asserted: the formula is correct at the ketones floor (`0.1`), the ketones ceiling (`20`), and a mid-range pair. Regression caught: a future edit to `computeGki` (e.g. swapping division order, using a wrong unit divisor) breaks a value hand-computed from the PRD formula, not a value the implementation itself produced. Research source: `research.md` "GKI calculation and the zero-ketone boundary". Anti-pattern avoided: per `test-plan.md` §6.1's licensed exception (b) and the `macros.test.ts` precedent (`derived = 4*200 = 800` written as a comment, not read from the parser), each expected value is written as the literal PRD-formula arithmetic (e.g. `20 / 18 / 0.1`) with a comment naming the scenario — not copied from a prior run of `computeGki`.

**Contract**: `describe("computeGki — formula and zero-ketone boundary (risk #4)")`. Import `computeGki` directly from `@/lib/services/biomarkers`. Cases (each a plain synchronous `it`, no MSW/DB needed):
- mid-range pair, e.g. glucose 90 / ketones 3 → `90 / 18 / 3`
- ketones at the Zod-enforced floor (`0.1`), e.g. glucose 20 / ketones 0.1 → `20 / 18 / 0.1`
- ketones at the ceiling (`20`), e.g. glucose 600 / ketones 20 → `600 / 18 / 20`

#### 2. Route-level zero-ketone rejection

**File**: `tests/api/biomarkers.test.ts` (new)

**Intent**: Prove the real request path never lets `ketonesMmolL = 0` (or a value below the Zod floor) reach `computeGki`/persistence — the actual "boundary produces a defined, correct result" property Risk #4 names, since the defined result for this input is "400, nothing written," not a GKI number. Regression caught: someone loosens or removes the `min(0.1)` bound, silently reintroducing the div-by-zero path. Research source: `research.md` "GKI calculation and the zero-ketone boundary", `context/archive/2026-06-30-biomarker-gki-logging/plan.md:70-72` (original design decision, never automated). Anti-pattern avoided: asserting only "not 200" — assert the exact `400` status and the exact absence of a PostgREST write (`postgrestTripwire`), per `test-plan.md` §6.4's request-boundary rejection pattern.

**Contract**: `describe("POST /api/biomarkers — ketones boundary rejects before persistence (risk #4)")`, using `buildApiContext` + `postgrestTripwire()` (mirrors `tests/api/meals.test.ts`'s existing pattern). Two cases:
- `ketones_mmol_l: 0` → 400, no PostgREST call
- `ketones_mmol_l: 0.05` (passes the DB `CHECK (> 0)` but fails the Zod `min(0.1)` floor) → 400, no PostgREST call — pins the documented Zod-stricter-than-DB gap from research

### Success Criteria:

#### Automated Verification:

- [ ] `npm test -- tests/services/biomarkers.test.ts` passes
- [ ] `npm test -- tests/api/biomarkers.test.ts` passes
- [ ] Full suite still passes: `npm test`

#### Manual Verification:

- [ ] Confirm the two new expected-value computations in `biomarkers.test.ts` were computed by hand from the PRD formula (not pasted from a `computeGki` run) by re-deriving one of them during review

---

## Phase 2: Daily aggregation empty-day asymmetry (meals + activities)

### Overview

Proves the single-day aggregation functions zero-fill an empty day while the range functions omit it — pinning both halves of the documented asymmetry explicitly, for both meals and activities.

### Changes Required:

#### 1. Pure zero-fill tests

**File**: `tests/services/meals.test.ts` (new)

**Intent**: Prove `sumDailyTotal([])` returns the zero-filled total, which is also a complete proof of `getDailyTotal`'s empty-day behavior (it has no logic beyond `sumDailyTotal(data)`). Behavior asserted: a day with no meals produces `{fat_g:0, protein_g:0, carbs_g:0, calories_kcal:0}`, never `null`/`undefined`/a throw. Regression caught: a future refactor changes the reduce's initial value or short-circuits differently on empty input. Research source: `research.md` "Daily macro aggregation and the calendar-day boundary". Anti-pattern avoided: none needed — this is a pure, deterministic structural assertion, not a value requiring an independent oracle.

**Contract**: `describe("sumDailyTotal — empty-day zero-fill (risk #4)")`. Import `sumDailyTotal` from `@/lib/services/meals`. One `it`: `sumDailyTotal([])` toEqual the zero-filled object. A second `it` sums two rows to confirm the non-empty path still works (guards against a trivial always-zero implementation passing the empty case for the wrong reason).

**File**: `tests/services/activities.test.ts` (new)

**Intent**: Same proof, mirrored for the structural twin. Behavior asserted: `sumDailyExpenditure([])` returns `{calories_kcal: 0}`. Regression caught / anti-pattern avoided: identical to meals, above.

**Contract**: `describe("sumDailyExpenditure — empty-day zero-fill (risk #4)")`. Import `sumDailyExpenditure` from `@/lib/services/activities`. Mirrors the meals file's two cases.

#### 2. Route-level omission tests

**File**: `tests/api/meals.test.ts` (extend existing file)

**Intent**: Prove `listDailyTotals`, reached through the real `GET /api/meals` range branch, omits a day with no meals from its result array rather than zero-filling it — the half of the asymmetry that can't be reached by a pure-function call, since the grouping/fold logic lives inside the async, DB-calling function. Explicitly named against the Phase-1-pure test above so the asymmetry itself — not just each half in isolation — is the property under test, per the regression-lock decision made this session. Behavior asserted: a `[from, to]` range where only `from` has a meal returns exactly one entry (for `from`), not two, and not a zero-filled entry for the empty day. Regression caught: a future "helpful" unification that makes `listDailyTotals` zero-fill like `getDailyTotal` does — silently changing the trend chart's data shape. Research source: `research.md` "Daily macro aggregation and the calendar-day boundary", `src/types.ts:40` ("Only days that have meals appear — there are no zero rows."). Anti-pattern avoided: don't assert only `response.status === 200` — assert the exact shape of `dailyTotals`.

**Contract**: New `describe("GET /api/meals — empty-day omission, not zero-fill, in range results (risk #4)")` block alongside the existing POST describe block. Uses `buildApiContext({ method: "GET", url: ".../api/test?from=2026-08-01&to=2026-08-02" })` and `server.use(postgrestRows("meals", [/* one row dated 2026-08-01 only */]))`. Asserts `response.status === 200` and `body.dailyTotals` has exactly one element with `day: "2026-08-01"`.

**File**: `tests/api/activities.test.ts` (new)

**Intent**: Same proof, mirrored for activities — this is the concrete test that fulfills the decision to extend aggregation-asymmetry coverage to `activities.ts`. Behavior asserted / regression caught / research source / anti-pattern avoided: identical to the meals case above, for `listDailyExpenditure` / `GET /api/activities`.

**Contract**: `describe("GET /api/activities — empty-day omission, not zero-fill, in range results (risk #4)")`, same shape as the meals version, stubbing `postgrestRows("activities", [...])` and asserting `body.dailyExpenditures`.

### Success Criteria:

#### Automated Verification:

- [ ] `npm test -- tests/services/meals.test.ts` passes
- [ ] `npm test -- tests/services/activities.test.ts` passes
- [ ] `npm test -- tests/api/meals.test.ts` passes (existing + new describe block)
- [ ] `npm test -- tests/api/activities.test.ts` passes
- [ ] Full suite still passes: `npm test`

#### Manual Verification:

- [ ] Read the four new/extended test files side by side and confirm the zero-fill vs. omission contrast is legible to someone unfamiliar with the asymmetry (naming, comments) — not just passing, but readable as documentation of the property

---

## Phase 3: Calendar-day validity boundary (meals route, representative)

### Overview

Proves `daySchema`'s round-trip validity refine correctly accepts/rejects calendar-date edge cases, tested once via the meals route per the cost×signal decision to treat the four duplicated copies as covered by their shared, currently-identical logic.

### Changes Required:

#### 1. Day-validity boundary tests

**File**: `tests/api/meals.test.ts` (extend further)

**Intent**: Prove the client-supplied `day` string is validated for real calendar existence — not just regex shape — before it ever reaches the `date`-column insert or the LLM parse call. Behavior asserted: a structurally-valid-but-nonexistent date (`2026-02-30`) and a regex-invalid date (`2026-13-45`) are both rejected with 400; a real leap day (`2024-02-29`) is accepted; the same `02-29` in a non-leap year (`2023-02-29`) is rejected. Regression caught: a future simplification of `daySchema` back to regex-only validation (dropping the `.refine()` round-trip check) — which is exactly the bug `context/archive/2026-06-09-meal-macro-logging/reviews/impl-review.md:50-52` fixed on 2026-06-20, with no automated test since. Research source: `research.md` "Daily macro aggregation and the calendar-day boundary" (correction to the original "24-hour rolling span" framing — no such code path exists; the real boundary is this refine). Anti-pattern avoided: the response-guidance line "whether aggregation reads a calendar day or a rolling 24-hour span" is explicitly *not* tested as a rolling-span scenario, since research confirmed no such code path exists — testing it would assert behavior the codebase doesn't have.

**Contract**: New `describe("GET/POST /api/meals — day validity boundary (risk #4)")` block. GET cases via `buildApiContext({ method: "GET", url: ".../api/test?day=<value>" })`, asserting `400` for the reject cases (no MSW stub needed — validation precedes any Supabase call, confirmed in Current State Analysis). POST cases via the existing `buildApiContext({ body: { description, day } })` pattern with `openRouterTripwire()` + `postgrestTripwire()` installed, asserting `400` and that neither tripwire fires — proving rejection happens before both the model call and the write, mirroring the existing Atwater-guard test's cost-control assertion style. Leap-day accept case: `day: "2024-02-29"` should reach the LLM stub (use `openRouterSuccess` with a valid macro payload) and return `201`, confirming the accept path isn't accidentally also rejected.

### Success Criteria:

#### Automated Verification:

- [ ] `npm test -- tests/api/meals.test.ts` passes (all three describe blocks)
- [ ] Full suite still passes: `npm test`

#### Manual Verification:

- [ ] Confirm `2024-02-29` / `2023-02-29` are correctly leap/non-leap by an independent calendar check (not just trusting the implementation's own `Date` round-trip) during review

---

## Phase 4: Mutation gate + cookbook sync

### Overview

Runs Stryker mutation testing scoped to the files touched by Phases 1-3, triages survived mutants, and closes out the rollout phase's documentation obligations.

### Changes Required:

#### 1. Selective mutation gate

**Intent**: Per `CLAUDE.md`'s mutation-testing guidance, verify the new assertions are precise enough to actually catch a broken implementation, not just observe a passing one — run Stryker scoped to the modules this phase's tests target, review the HTML report, and for each survived mutant ask "would this change hurt a user or the business?" Add an assertion only for mutants where the answer is yes; consciously ignore (and note why) equivalent/cosmetic survivors.

**Contract**: `npx stryker run --mutate "src/lib/services/biomarkers.ts,src/lib/services/meals.ts,src/lib/services/activities.ts"` (adjust the glob if Stryker isn't yet configured in this repo — if no `stryker.conf.*` exists, this sub-phase's first step is a minimal config scoped to these three files, following Stryker's Vitest-runner setup for the existing `vitest.config.ts`).

#### 2. Cookbook and change-log sync

**File**: `context/foundation/test-plan.md`

**Intent**: Record Phase 2's shipped patterns in §6.6, per this session's task instruction, so future phases (and future contributors) inherit the conventions without re-deriving them.

**Contract**: Add a `**§3 Phase 2 (testing-deterministic-domain-math, complete YYYY-MM-DD):**` subsection under §6.6 with entries covering: (a) `daySchema` is a private, per-route, duplicated Zod schema — pin it via the route harness, never assume it's importable; (b) the empty-day asymmetry (`getDailyTotal` zero-fills, `listDailyTotals` omits) is intentional and now regression-locked — don't "fix" one to match the other without updating both the code comments and this test; (c) GKI's div-by-zero guard lives entirely upstream of `computeGki`, enforced by a Zod floor stricter than the DB CHECK; (d) the leap-year gotcha (2026 is not a leap year — use 2024/2023 for leap-day test pairs in this repo's timeframe).

### Success Criteria:

#### Automated Verification:

- [ ] `npx stryker run` completes and produces an HTML report
- [ ] Full suite still passes after any mutant-driven assertion additions: `npm test`

#### Manual Verification:

- [ ] Every survived mutant has an explicit ignore/fix decision recorded (in the PR description or a code comment), not silently left unreviewed
- [ ] `test-plan.md` §6.6 Phase 2 entry reads clearly to someone who hasn't read this plan

---

## Testing Strategy

### Unit Tests:

- `computeGki` across its valid domain (floor, ceiling, mid-range), independently computed
- `sumDailyTotal([])` / `sumDailyExpenditure([])` zero-fill
- `daySchema` validity boundary via the meals route (structurally invalid, structurally-valid-but-nonexistent, leap-day accept/reject)

### Integration Tests (hermetic, MSW-stubbed — no live DB):

- `POST /api/biomarkers` ketones-boundary rejection (0 and 0.05), no persistence
- `GET /api/meals` / `GET /api/activities` range omission of an empty day
- `POST /api/meals` day-validity rejection, no model call and no persistence

### Manual Testing Steps:

1. Re-derive one hand-computed GKI expected value independently during review.
2. Read the meals/activities zero-fill vs. omission tests side by side and confirm the asymmetry reads as intentional, documented behavior.
3. Independently verify the leap-year test dates (2024 leap, 2023 not).
4. Review the Stryker HTML report's survived-mutant list and confirm each has a recorded decision.

## Performance Considerations

None — all new tests are synchronous pure-function calls or hermetic MSW-stubbed route calls; no live network, no live database.

## Migration Notes

Not applicable — no schema or data changes.

## References

- Related research: `context/changes/testing-deterministic-domain-math/research.md`
- Phase 1 precedent: `tests/services/macros.test.ts`, `tests/api/meals.test.ts`, `tests/helpers/msw.ts`, `tests/helpers/api-context.ts`
- `context/archive/2026-06-30-biomarker-gki-logging/plan.md:70-72` — original GKI div-by-zero design decision
- `context/archive/2026-06-09-meal-macro-logging/reviews/impl-review.md:50-52` — `daySchema` round-trip fix (2026-06-20)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: GKI zero-ketone boundary

#### Automated

- [x] 1.1 `npm test -- tests/services/biomarkers.test.ts` passes — bdc26ef
- [x] 1.2 `npm test -- tests/api/biomarkers.test.ts` passes — bdc26ef
- [x] 1.3 Full suite still passes: `npm test` — bdc26ef

#### Manual

- [x] 1.4 Confirm the two new expected-value computations in `biomarkers.test.ts` were computed by hand from the PRD formula — bdc26ef

### Phase 2: Daily aggregation empty-day asymmetry (meals + activities)

#### Automated

- [x] 2.1 `npm test -- tests/services/meals.test.ts` passes — 642b18d
- [x] 2.2 `npm test -- tests/services/activities.test.ts` passes — 642b18d
- [x] 2.3 `npm test -- tests/api/meals.test.ts` passes (existing + new describe block) — 642b18d
- [x] 2.4 `npm test -- tests/api/activities.test.ts` passes — 642b18d
- [x] 2.5 Full suite still passes: `npm test` — 642b18d

#### Manual

- [x] 2.6 Read the four new/extended test files side by side and confirm the zero-fill vs. omission contrast is legible — 642b18d

### Phase 3: Calendar-day validity boundary (meals route, representative)

#### Automated

- [x] 3.1 `npm test -- tests/api/meals.test.ts` passes (all three describe blocks) — 755cb35
- [x] 3.2 Full suite still passes: `npm test` — 755cb35

#### Manual

- [x] 3.3 Confirm `2024-02-29` / `2023-02-29` are correctly leap/non-leap independently — 755cb35

### Phase 4: Mutation gate + cookbook sync

#### Automated

- [x] 4.1 `npx stryker run` completes and produces an HTML report — 30e6780
- [x] 4.2 Full suite still passes after any mutant-driven assertion additions: `npm test` — 30e6780

#### Manual

- [x] 4.3 Every survived mutant has an explicit ignore/fix decision recorded — 30e6780
- [x] 4.4 `test-plan.md` §6.6 Phase 2 entry reads clearly to someone who hasn't read this plan — 30e6780
