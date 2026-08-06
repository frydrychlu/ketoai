<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Deterministic Domain Math (Risk #4)

- **Plan**: context/changes/testing-deterministic-domain-math/plan.md
- **Scope**: Full plan — Phases 1-4 of 4
- **Date**: 2026-08-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Test-only change (no production code touched) implementing 4 phases against Risk #4 (daily macro total / GKI boundary correctness). All planned files match their described intent exactly. Two items exist beyond the literal plan text — a same-day-accumulation test added to `tests/api/meals.test.ts`/`tests/api/activities.test.ts`, and a `body.total` assertion strengthening the leap-day accept test — both driven by Stryker mutation-testing findings during Phase 4 and explicitly documented in `test-plan.md` §6.6; both close real gaps, not scope creep. Full suite: 11 files, 64 tests, all passing (re-verified during this review). Two independent sub-agent passes (plan-drift, safety/quality/pattern) returned zero CRITICAL or WARNING findings.

## Findings

### F1 — No npm script wires `npx stryker run`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: package.json
- **Detail**: Stryker is invoked ad hoc via the command documented in `test-plan.md` §6.6, not wired as an `npm run` script. This is intentional per `CLAUDE.md`'s mutation-testing guidance ("a selective quality gate... not a CI gate on every commit") — noted for completeness, not a defect.
- **Fix**: None needed. Optionally add `"mutate": "stryker run"` to package.json scripts if ad hoc `npx` invocation proves inconvenient in practice.
- **Decision**: FIXED + ACCEPTED-AS-RULE: "Ad hoc mutation-testing invocation, not an npm script" (context/foundation/lessons.md)

### F2 — Hermetic MSW stub can't verify exact PostgREST query params

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/helpers/msw.ts (postgrestRows)
- **Detail**: `postgrestRows()` ignores query-string params (select fields, `.gte`/`.lte` values, ordering), so range-boundary tests only prove the route/service correctly folds whatever PostgREST returns — not that the exact query sent is correct. This is the same, already-acknowledged limitation `test-plan.md` §6.6 records against the 22 deliberately-deferred Stryker survivors (query-builder string/ordering mutants), scoped to Phase 3's real-Supabase integration layer to close. Not a new gap introduced by this diff.
- **Fix**: None needed this phase. Revisit when Phase 3 (`Isolation and ownership as a gate`) makes the local Supabase stack a test dependency.
- **Decision**: ACCEPTED-AS-RULE: "Hermetic PostgREST stub can't verify exact query params" (context/foundation/lessons.md) — no code change, deferred to rollout Phase 3

### F3 — `.gitignore` addition not named in the plan text

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .gitignore
- **Detail**: Phase 4's plan text anticipated a first-time Stryker config as a contingency but didn't explicitly call out a `.gitignore` update. The addition (`reports/mutation/`, `.stryker-tmp/`) is a direct, low-risk consequence of that anticipated setup — confirmed these are the only paths Stryker actually generates, and the pattern doesn't over-broadly ignore the rest of `reports/` (no other use of that directory exists in the repo).
- **Fix**: None needed — correctly scoped, natural fallout of an explicitly anticipated contingency.
- **Decision**: SKIPPED
