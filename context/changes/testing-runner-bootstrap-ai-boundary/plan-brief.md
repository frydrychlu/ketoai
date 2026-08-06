# Test-Runner Bootstrap and AI Boundary — Plan Brief

> Full plan: `context/changes/testing-runner-bootstrap-ai-boundary/plan.md`
> Research: `context/changes/testing-runner-bootstrap-ai-boundary/research.md`

## What & Why

Rollout Phase 1 of the test plan. It brings the first test runner into a repo with zero test files, then uses it to protect two things: that a wrong-but-well-formed AI number cannot silently persist and corrupt every daily total, trend, and analysis built on it (risk #1), and that a hostile analysis request is rejected before it costs a model call (risk #7).

The two risks arrive in opposite states, and that asymmetry shapes the whole plan. **Risk #7's boundary is already correct** — its tests are a regression lock that passes on day one. **Risk #1's ceiling does not exist** — its tests fail until the guard ships with them.

## Starting Point

No test infrastructure at all: no runner, no config, no stubbing library, no `test` script.

Risk #1 is real and unexamined. Every user-typed physiological value in the codebase is bounded at both ends; every AI-derived numeric is bounded only below. The floor was retrofitted in June 2026; a ceiling was never raised in any plan or review. `calories_kcal: 999999` clears Zod, clears the DB CHECK, and is written verbatim.

Risk #7 turned out half-closed. `window_days` is a three-literal union `{7, 14, 30}`, not a range — everything else returns 400 before any DB read or model call. But that bound exists only as a side effect of an archived scope decision ("no free-form or slider N"), and nothing in the code says it matters. What N does *not* bound is per-request payload: `health_goals` is capped nowhere — not in the textarea, not in Zod, not in the DB — and is re-sent in full on every analysis request, so N=7 and N=30 cost the same in that dimension.

## Desired End State

`npm test` exists and passes. Without a live model call and without Docker, the suite proves that an implausible macro response is refused and writes no row; that a hostile `window_days` returns exactly 400 with zero outbound requests of any kind; and that the free-text field feeding the analysis prompt is bounded. Ordinary meal logging, activity logging, and all three analysis windows still work unchanged.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Test runner | Vitest 4, `node` env, hand-written config | `getViteConfig()` activates the Cloudflare adapter, which is hostile to Vitest 4 on these versions | Research |
| Model stubbing | MSW 2 at the network edge | The app calls global `fetch` directly; an interceptor sees the real request, so tests assert *what was sent* | Research |
| Guards vs red tests | Guards ship with the tests | Phase 1 ends green, so it can become a CI gate rather than a suite that must stay broken | Change.md |
| Ceiling shape | Per-field, Zod **and** DB CHECK | Completes the repo's own convention and closes the RLS-update path where Zod never runs | Plan |
| Cross-field check | Asymmetric Atwater band (reject below 75% of derived) | Only oracle in this risk that derives an expected value from *other fields*. Asymmetry absorbs the caveats: alcohol pushes reported high (tolerated), fibre pushes computed ~10% high (inside the slack) | Plan |
| `health_goals` | Full triple: Zod, CHECK, `maxLength`, at 2000 | Copies `wellness.notes` exactly, so the number needs no separate justification | Plan |
| `max_tokens` | Not added | A ceiling tight enough to matter truncates the JSON, Zod rejects, and the retry repeats the prompt — a cost control that doubles cost | Plan |
| CI wiring | `test` script only, no workflow edit | CI triggers on `master` while the repo is `main`, so a test step would advertise a gate that never runs. Phase 5 owns it | Plan |
| DB CHECK coverage | Zod-level tests only | User's call — CHECKs ship as defense-in-depth, unverified until Phase 3 makes Supabase a test dependency | Plan |

## Scope

**In scope:** Vitest + MSW harness, `astro:env/server` stub, `APIContext` route harness, `tests/**` lint override; risk-#7 boundary tests; ceilings on all five AI-derived numerics (Zod + migration); the Atwater band; the `health_goals` triple; test-plan §6 cookbook.

**Out of scope:** `max_tokens`; CI workflow changes; DB integration tests and SQL recipes for the new CHECKs; profile input to the activity estimate (Q3); the 422-on-config-fault misclassification (Q5); the `max_rows = 1000` silent truncation (Q8 — recorded against risk #4); e2e, component rendering, `.astro` compilation; any shared LLM-boundary refactor.

## Architecture / Approach

Tests live in a top-level `tests/` tree — **not** under `src/pages/`, where Astro would turn every `.ts` file into a live route. One MSW server intercepts all outbound `fetch`, which covers both OpenRouter and Supabase, since `createClient` injects no custom fetch. That single fact is what makes "wrote no row" assertable as "no POST to `/rest/v1/meals`", using a throwing tripwire rather than a call count so failures name themselves.

Guards go into the existing schema modules rather than a new shared layer, so the stub seam the tests target does not move.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Runner bootstrap | Vitest + MSW + env stub + route harness + lint override + smoke test | The Astro/Cloudflare adapter incompatibility resurfacing through some other path |
| 2. Risk #7 boundary lock | Seven properties, green against unchanged code | Writing 7.1 as a mirror test by importing `ANALYSIS_WINDOWS` instead of hard-coding |
| 3. Risk #1 guards + tests | Ceilings (Zod + migration), Atwater band, rejection tests | The band false-rejecting legitimate meals — mitigated by two explicit accept-cases |
| 4. `health_goals` bound | Zod + CHECK + `maxLength` + test | Smallest phase; migration failing on pre-existing over-long data |
| 5. Cookbook + sync | §6 patterns filled, §3/§4/§5 status, risk-map corrections | Writing principles instead of copyable patterns |

**Prerequisites:** Docker running for the two `db reset` verifications in Phases 3 and 4. Nothing else — the automated suite is dependency-free.

**Estimated effort:** ~3-4 sessions. Phase 1 is the largest (new toolchain); Phases 2-4 are each roughly a session; Phase 5 is short.

## Open Risks & Assumptions

- **The new DB CHECKs ship untested** (your call). They are verified only by the migration applying cleanly. A later migration could weaken one with no automated signal until Phase 3 makes Supabase a test dependency.
- **The Atwater constants (0.75, the 50 kcal floor) are judgment calls, not sourced values.** No PRD line fixes them. They need a comment saying so, or a future reader will treat them as derived.
- **A guard rejection costs two model calls, not one** — the retry loop treats schema failures as retryable. Accepted deliberately and asserted by test rather than left implicit.
- **Between this change and §3 Phase 5 there is no automated enforcement.** The suite runs only when someone runs it, because CI still triggers on the wrong branch.
- **Both migrations fail if pre-existing data violates them.** Expected to be a non-issue on a single-user dev database, but violating rows should be inspected, not accommodated.

## Success Criteria (Summary)

- A model response that is over-ceiling or internally inconsistent is refused, surfaces as 422, and leaves no row behind.
- An out-of-range or hostile `window_days` returns exactly 400 and produces zero outbound requests — no model call and no database read.
- `npm test`, `npm run lint`, and `npx astro check` all pass, and ordinary logging and analysis still work in the running app.
