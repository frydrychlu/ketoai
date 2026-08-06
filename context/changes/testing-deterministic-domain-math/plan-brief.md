# Deterministic Domain Math (Risk #4) — Plan Brief

> Full plan: `context/changes/testing-deterministic-domain-math/plan.md`
> Research: `context/changes/testing-deterministic-domain-math/research.md`

## What & Why

Rollout Phase 2 of the test plan: prove that daily macro totals and the GKI biomarker index behave correctly at their boundaries — zero ketones, a day with no logged entries, and an entry landing on a calendar-date edge — not just on the happy path. This is the risk-first quality contract from Lesson 1 applied to the domain-math layer: these are properties the code already gets right, but nothing catches a future regression today.

## Starting Point

Three properties exist in production code with zero automated test coverage: `computeGki` is an unguarded formula whose div-by-zero protection lives entirely upstream (Zod + DB CHECK); daily aggregation has two different, both-intentional empty-day behaviors (`getDailyTotal` zero-fills, `listDailyTotals` omits); and the calendar-date validity gate (`daySchema`) is a private, per-route Zod schema duplicated four times, hardened once in 2026-06 but never pinned by a test.

## Desired End State

`npm test` includes new unit and hermetic route-level tests that would fail if any of these three boundaries regressed — an unguarded GKI divide-by-zero reaching persistence, the empty-day asymmetry being silently "fixed" into a single behavior, or the calendar-validity refine being simplified back to regex-only. `test-plan.md` §6.6 carries the shipped cookbook patterns for the next rollout phase to build on.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Backport the `max_rows=1000` truncation lead now vs. defer | Defer to `--refresh` | It's a data-completeness defect one layer upstream of the domain math, not a Risk #4 boundary defect — recorded in research for the next refresh pass | Research |
| Include `activities.ts`'s identical aggregation pattern | Yes, widen scope | Same failure shape as meals, near-zero marginal cost once the meals test exists, even though Risk #4's wording only names "macro total" | Plan |
| `daySchema` day-validity coverage breadth | One representative route (meals) | The four duplicated copies are currently byte-identical; testing all four is boilerplate for one logical property | Plan |
| Empty-day asymmetry regression lock | Dedicated, explicitly-named test | The asymmetry itself (not just each half) is the actual regression risk a future "helpful" refactor could introduce | Plan |
| Mutation-testing gate | Run Stryker, scoped to touched files | Matches `CLAUDE.md`'s guidance to verify new assertions are precise, not just passing, right after a risk phase ships | Plan |
| How to test `listDailyTotals`'s omission behavior | Route-level (MSW-stubbed), not a production refactor | The fold/group logic lives inside the async DB-calling function; extracting it purely to enable a test would be a refactor for testability's own sake | Plan |

## Scope

**In scope:**
- `computeGki` formula + zero-ketone rejection (biomarkers)
- Empty-day aggregation asymmetry, meals and activities
- Calendar-date validity boundary, tested via the meals route
- A scoped Stryker mutation-testing pass and `test-plan.md` §6.6 cookbook update

**Out of scope:**
- Any production code change (all three properties are already correct)
- The `max_rows=1000` silent-truncation lead (deferred to `--refresh`)
- The NaN/Infinity-via-direct-PostgREST-PATCH gap (unassigned, likely an RLS/isolation-phase concern)
- Day-validity tests for the biomarkers/activities/analysis routes' `daySchema` copies
- Any live local-Supabase integration testing (that's Phase 3's job)

## Architecture / Approach

All new tests are either pure-function unit tests (`computeGki`, `sumDailyTotal`, `sumDailyExpenditure` called directly, no I/O) or hermetic route-level tests reusing Phase 1's `buildApiContext` + MSW harness (no live network, no live database) — exactly the pattern `tests/api/meals.test.ts` and `tests/services/macros.test.ts` already established. No new test infrastructure is introduced.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. GKI zero-ketone boundary | Pure formula tests + a route-level rejection test proving no div-by-zero can reach persistence | Hand-computed oracle values must be independently derived, not copied from the implementation |
| 2. Daily aggregation empty-day asymmetry (meals + activities) | Pure zero-fill tests + route-level omission tests, explicitly contrasted | The omission property can only be reached through the real async function — getting the MSW stub wrong would give false confidence |
| 3. Calendar-day validity boundary | Route-level accept/reject tests including the leap-day edge | Leap-year arithmetic mistake (2026 is not a leap year) would silently test the wrong thing |
| 4. Mutation gate + cookbook sync | Scoped Stryker run + `test-plan.md` §6.6 update | Stryker may not yet be configured in this repo — first-time setup cost if so |

**Prerequisites:** None beyond what Phase 1 already established (Vitest, MSW, `buildApiContext`) — no Docker/local Supabase stack needed.
**Estimated effort:** ~1 session across 4 phases — this is a test-only phase with no production code changes.

## Open Risks & Assumptions

- Assumes Stryker is not yet configured for this repo; Phase 4 includes a minimal first-time setup if so, scoped narrowly to the three touched service files.
- Assumes the four `daySchema` copies remain byte-identical going forward; if they diverge, the single-route coverage decision should be revisited.

## Success Criteria (Summary)

- `npm test` passes with all new/extended test files, and the full existing suite remains green.
- Each of Risk #4's three named boundaries (zero ketones, empty day, day-boundary) has at least one test that would fail against a plausible regression, not just against the happy path.
- `test-plan.md` §6.6 has a dated Phase 2 entry a future contributor can act on without re-reading this plan.
