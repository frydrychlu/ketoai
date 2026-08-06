---
change_id: testing-runner-bootstrap-ai-boundary
title: Test-runner bootstrap and AI boundary
status: implementing
created: 2026-08-04
updated: 2026-08-06
archived_at: null
---

## Notes

Rollout phase 1 of `context/foundation/test-plan.md` §3. Covers risk #1
(wrong-but-well-formed AI value persists silently) and risk #7 (unbounded N on
the analysis endpoint).

Research scope as run on 2026-08-04: **risk #1 only**, plus the test-runner and
model-stubbing selection that §4 assigns to this phase.

Second research pass, 2026-08-06: **risk #7 only** (appended to `research.md` as a
delimited section). Both risks are now researched; the phase is ready for `/10x-plan`.

### Risk #7 outcome (2026-08-06)

- **The parameter half is already closed.** `window_days` is a three-literal union
  ({7, 14, 30}), not a range — every other value returns 400 before any DB read or
  model call. The bound exists because the archived plan cut free-form N as scope
  discipline (`.../on-demand-ai-analysis/plan.md:36`), not as a deliberate guard.
  The seven risk-#7 tests are a **regression lock** on that decision and will pass
  against current code.
- **The surviving defect is `health_goals`** — unbounded at textarea, Zod, and DB,
  and re-sent in full on every analysis request at every window size. This is the
  "in range but selects unbounded data" face of the risk. Fixing it touches the
  *profile* route, widening Phase 1's blast radius (new Q6).
- **Also open:** no `max_tokens` on any of the three LLM calls (new Q7).
- **Deferred out:** `max_rows = 1000` silent truncation on the meal/activity range
  reads — a correctness defect in no risk's scope today; belongs with risk #4 at the
  next `--refresh` (new Q8), not in this phase.

## Decisions (2026-08-06, via `/10x-plan`)

Answers to the research Open Questions, settling the plan's five phases:

- **Q1 ceiling — per-field, Zod *and* DB CHECK.** 1000 g per macro, 10 000 kcal on
  both `meals.calories_kcal` and `activities.calories_kcal`. Completes the repo's
  bound-both-ends convention and closes the unused `*_update_own` RLS path where Zod
  never runs.
- **Q2 Atwater — asymmetric band.** Reject when reported calories fall below 75% of
  `9·fat + 4·protein + 4·carbs`, applied only when that derived value is ≥ 50 kcal.
  Tolerate reported *above* computed without limit. The asymmetry is what absorbs the
  caveats: alcohol (~7 kcal/g, represented by none of the four fields) pushes reported
  high; fibre pushes computed ~7–10% high, inside the slack. **0.75 and 50 are judgment
  calls, not sourced values** — they must be commented as such.
- **Q6 `health_goals` — in, full triple** at 2000 chars (Zod `.max`, `char_length`
  CHECK, textarea `maxLength`), copying `wellness.notes` exactly.
- **Q7 `max_tokens` — not added.** A ceiling tight enough to constrain spend truncates
  the analysis mid-JSON; Zod then rejects and the retry repeats the whole prompt,
  turning a cost control into a cost doubler. Recorded as an open gap.
- **CI — `test` script only, no workflow edit.** Adding a step to a workflow that never
  fires would advertise a gate that does not execute. §3 Phase 5 lands it with the
  branch-trigger fix.
- **DB CHECK coverage — Zod-level tests only** (user's call, against the recommendation).
  The CHECKs ship as defense-in-depth and are verified solely by the migration applying
  cleanly. **Accepted risk:** a later migration could weaken one with no automated signal
  until §3 Phase 3 makes the local Supabase stack a test dependency.

### Implementation progress

- **Phase 1 (runner bootstrap) landed at `6febac8`.** Vitest 4 + MSW 2, the
  `astro:env/server` stub, MSW tripwire harness, `APIContext` route harness,
  `tests/**` ESLint override, and a passing smoke test. One unplanned fix along
  the way: `npm run lint` was failing on 20 pre-existing errors inside
  `.claude/worktrees/research-ai-boundary/`, a stray untracked nested repo copy
  unrelated to this change — excluded via `.gitignore` (directory left untouched).
- **Phase 2 (risk #7 request-boundary lock) landed at `284d55b`.** All 22 tests
  pass against unchanged production code — a pure regression lock, no red tests.
  Verified the lock is real (not a mirror) by temporarily widening
  `ANALYSIS_WINDOWS` to include `31`: exactly the `rejects window_days=31` case
  failed, confirming the hard-coded rejected-values list catches drift instead of
  silently absorbing it.
- **Phase 3 (risk #1 guards + tests) landed.** Ceilings (Zod + DB CHECK) on all
  five AI-derived numerics, plus the asymmetric Atwater band on the meal path.
  18 new tests, 44/44 total. Verified each guard binds to its test — not
  incidental behaviour — by reverting each in isolation: ceilings-only revert
  failed exactly the 4 ceiling tests, Atwater-only revert failed exactly the 1
  Atwater-rejection test, activity-ceiling revert failed exactly its 1 test; all
  other tests stayed green in each case. Migration verified against a fresh
  local stack (`npx supabase db reset`).
- **Phase 4 (health_goals bound) landed.** Applied the exact `wellness.notes`
  triple at 2000 chars: Zod `.max(2000)`, a DB CHECK, and textarea `maxLength`.
  `tests/helpers/api-context.ts` gained a `formBody` variant and a `redirect`
  stub, since the profile route reads `FormData` and calls `context.redirect`
  rather than returning JSON. 2 new tests, 46/46 total. Closes risk #7's one
  surviving defect from research.
- **Phase 5 (cookbook + plan sync) landed — rollout phase complete.**
  `test-plan.md` §6.1/§6.2/§6.4/§6.6 filled in with concrete, file-referenced
  patterns; §3 Phase 1 status → complete; §4 stack rows name Vitest 4.1.10 and
  MSW 2.15.0; §5 gained a caveat that the "required" gate is a target state,
  not proof CI runs (branch-trigger fix stays with §3 Phase 5); §2 risk #1 and
  #7 rows recorded as closed with their judgment-call constants flagged for
  re-evaluation; risk #4 gained the `max_rows = 1000` finding as an unacted
  pointer for the next `--refresh`.

### Consequences carried into the plan

- Tests live in a top-level `tests/` tree — Astro routes every `.ts` file under
  `src/pages/`, so a colocated test file would become a live endpoint.
- A guard rejection costs **two** model calls, not one: the retry loop treats any
  non-`OpenRouterError` as retryable, which now includes ceiling and Atwater failures.
  Kept deliberately and asserted by test rather than left implicit.
- Test 7.1 must **hard-code** 7/14/30 rather than import `ANALYSIS_WINDOWS` — importing
  the constant the route validates against is a mirror test, and failing when someone
  widens that constant is the test's entire purpose.

## Decisions (2026-08-06, via `/10x-test-plan`)

Recorded before planning, in answer to the Open Questions in `research.md`:

- **Risk #7 is researched before planning.** A second research pass, scoped to the
  unbounded `N` on the analysis endpoint, runs first; `/10x-plan` then covers #1
  and #7 together as §3 promises. Output appends to `research.md`.
- **Q1 / Q2 — guards ship alongside the tests.** Phase 1 adds the missing plausibility
  guard to both AI paths (sanity ceiling, and an Atwater tolerance band if the band
  width survives the fibre/alcohol caveats) *and* the tests that prove it. Phase 1
  ends green rather than leaving a red suite that cannot become a CI gate.
- **Q3, Q4, Q5 — out of scope.** No profile input to the activity estimate (scope
  growth beyond testing), no CI branch-trigger fix, no 422-on-config-fault change
  (that is Lesson 5's bug→fix→regression workflow).
- **Consequence to carry forward:** `.github/workflows/ci.yml` triggers on `master`
  while this repo's branch and default is `main`, so no workflow runs today. With Q4
  excluded, the "unit + integration required after §3 Phase 1" gate in `test-plan.md`
  §5 will not execute when Phase 1 lands. §3 Phase 5 already owns gate wiring — the
  branch-trigger fix belongs there.

### Backported to `test-plan.md` §2 on 2026-08-06

- Risk #1 Source: the archived "column accepts negatives" evidence was stale (the
  floor closed 2026-06-20). Replaced with the surviving evidence — the bounded/unbounded
  asymmetry between user-typed and AI-derived numerics, and the fact that no review
  ever raised a ceiling.
- Risk #1 Response Guidance: oracle sharpened from "expected values must come from the
  meal description" to "expected *values* are not assertable at all; only expected
  *rejections* are."
