# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Ad hoc mutation-testing invocation, not an npm script

**Context**: package.json (Stryker mutation-testing setup, test-plan.md §6.6)

**Problem**: Stryker is invoked ad hoc via `npx stryker run` per test-plan.md §6.6's documented command, with no wiring into an `npm run` script.

**Rule**: _(fill in)_

**Applies to**: _(fill in)_

## Hermetic PostgREST stub can't verify exact query params

**Context**: tests/helpers/msw.ts (postgrestRows) — surfaced by Stryker mutation testing in Phase 2 (testing-deterministic-domain-math)

**Problem**: postgrestRows() ignores query-string params entirely, so hermetic route tests prove result-shape correctness but not that the exact query (select fields, .gte/.lte values, ordering) sent to PostgREST is correct — 22 Stryker mutants in query-builder args survived for exactly this reason.

**Rule**: _(fill in)_

**Applies to**: _(fill in)_
