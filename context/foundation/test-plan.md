# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-06

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the risk wins. Do not promote to e2e because e2e "feels safer." Do not put a vision model on top of a deterministic visual diff that already catches the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team is worried about X, and the failure would surface somewhere in `<area>`" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what could fail* and *why we believe it's likely* — drawn from documents, interview, and codebase *signal* (churn, structure, test base). It does NOT claim to know which line owns the failure. That knowledge is produced by `/10x-research` during each rollout phase. If the plan and research disagree about where the failure lives, research is the ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` — excluding `context/`, docs, fixtures, and build output. Primary window is 90 days (73 commits); the 30-day window holds only 10 commits and is used as a recency tiebreak, not as the main signal.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by risk = impact × likelihood. Risks are failure scenarios in user / business terms, not test names. The Source column cites the *evidence that surfaced this risk* — never a specific file as "where the failure lives" (that is research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | An AI-parsed macro or activity estimate is wrong but well-formed, passes validation, persists, and silently corrupts every daily total, trend, and analysis built on it | High | High | interview Q1 (top stated worry); interview Q3 (AI service layer named low-confidence); PRD FR-004 and FR-005 Socrates notes ("error-prone and poisons downstream metrics"); hot-spot dir `src/lib/services/` — 18 commits/90d; validation asymmetry — user-typed physiological values are bounded at both ends while AI-derived numerics are bounded only below; no review or plan across either AI feature ever raised an upper bound (corrected from the earlier "column accepts negatives" citation, backported from Phase 1 research 2026-08-04 — that floor was closed on 2026-06-20 and the surviving gap is the unexamined ceiling). **Closed by §3 Phase 1 (2026-08-06):** per-field ceilings shipped in Zod + DB CHECK on all five AI-derived numerics, plus an asymmetric Atwater consistency band on the meal path (reject only when reported calories fall well below the macro-derived value; alcohol/fibre entries tolerated by design). The ceiling values (1000 g / 10 000 kcal) and the band's 0.75 factor and 50 kcal floor are judgment calls, not sourced from the PRD — re-evaluate if real usage shows them too tight or too loose |
| 2 | One user's health data becomes readable by another user through a mis-set or missing row-level policy on a newly added table | High | Medium | PRD §Non-Functional Requirements, §Success Criteria/Guardrails, Business Logic rule 4 (hard guardrail); `AGENTS.md` hard rule (RLS with four granular per-operation policies per table); hot-spot dirs `supabase/migrations/` — 8 commits/90d and `supabase/tests/` — 6 commits/90d; isolation verification exists only as a hand-run recipe and is absent from CI |
| 3 | An authenticated user reads or mutates a record belonging to someone else — the endpoint checks *logged in*, not *yours* | High | Medium | PRD §Access Control ("every authenticated user accesses only their own data"; flat role model); hot-spot dir `src/pages/api/` — 20 commits/90d (top directory); abuse lens — authorization / ownership class |
| 4 | A daily macro total or GKI value is plausible but wrong at a boundary — zero ketones, a day with no entries, or an entry landing on the wrong calendar day | High | Medium | PRD Business Logic rules 1 and 2 (explicit formulas); PRD FR-006 Socrates resolution (units fixed; GKI never user-entered); hot-spot dirs `src/lib/services/` — 18 commits/90d and `src/pages/` — 15 commits/90d; interview Q3. **Added by §3 Phase 1 research (2026-08-06, not acted on — flagged for `/10x-test-plan --refresh`):** `supabase/config.toml` sets `max_rows = 1000`; the meal/activity range reads (`listDailyTotals`, `listDailyExpenditure`) fetch every row in range with no pagination, so a window past ~33 meals/day silently truncates with no error — the daily totals feeding both the trends chart and the FR-012 analysis prompt go quietly wrong |
| 5 | The past-day view shows the wrong day's data, or exposes a create / edit / delete affordance that US-02 forbids | Medium-High | High | PRD US-02 acceptance criteria and FR-011; hot-spot dir `src/components/history/` — 5 commits/30d (hottest recent window); hot-spot dir `src/pages/` — 15 commits/90d; interview Q3 (dashboard and charts named low-confidence) |
| 6 | The analysis states a confident cause on a sparse window instead of hedging, and the user changes their diet on it | Medium-High | Medium | PRD FR-012 and its Socrates resolution ("must state its confidence level and data limitations explicitly"); Business Logic rule 3; roadmap S-09 Unknowns — how the sparse-window hedging contract is enforced was deferred to planning and never recorded as resolved; hot-spot dir `src/components/analysis/` — new in the 30d window |
| 7 | An oversized analysis request turns one click into unbounded prompt size and spend — not via N, which is bounded, but via a per-request payload that N does not constrain | Medium | Medium | PRD FR-012 (N is a user-set parameter, and FR-012 itself fixes no maximum); abuse lens — untrusted-input and resource-abuse classes. **Corrected by Phase 1 research 2026-08-06:** the "unbounded N" premise is closed — `window_days` is a three-literal union {7, 14, 30} and every other value is rejected before any DB read or model call, a bound that exists only because the archived plan cut free-form N as scope discipline. The surviving evidence was `health_goals`: unbounded at textarea, Zod, and DB, and re-sent in full on every analysis request at every window size, so N=7 and N=30 cost the same in that dimension. Two earlier citations are weaker than stated — impl-review F1 is about request *frequency* (excluded by §7), and `tech-stack.md` records no numeric free-tier limits; the cost lands at OpenRouter, not at the Workers runtime. **`health_goals` closed by §3 Phase 1 (2026-08-06):** the `wellness.notes` triple (Zod `.max(2000)`, DB CHECK, textarea `maxLength`) now applies to it too. **Still open:** no `max_tokens` on any of the three LLM calls — deliberately not added, since a ceiling tight enough to matter truncates a legitimate response mid-JSON and the retry loop then repeats the whole prompt, turning a cost control into a cost doubler |

High-impact × Low-likelihood scenarios were considered and deliberately left out of the map: a Supabase or Cloudflare outage, and an OpenRouter provider outage. These are observability and alerting concerns, not test targets — a test cannot prevent them and asserting on them only mirrors the implementation.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | A model response that is well-formed but nutritionally implausible or out of range is rejected outright — it never becomes a persisted row | "It passed schema validation, so it is correct." Schema-valid is not the same as plausible | The parse → validate → persist path; where the validation boundary sits; what the database accepts versus what the schema accepts; how a rejection surfaces to the user | unit + integration against stubbed model responses | The oracle problem. Sharpened by Phase 1 research (2026-08-04): expected macro *values* are not assertable at all, because the PRD accepts ±30–50% estimate inaccuracy — asserting them only proves the stub the test wrote came back. Only expected *rejections* have an oracle. Assert boundary behaviour, never values |
| #2 | A second user's authenticated session reads zero rows of the first user's data, across every user-owned table and every operation | "RLS is enabled, so the table is isolated." Enabled is not the same as four correct policies | How the SSR client binds the authenticated identity to a query; what the existing canary recipe actually asserts; which user-owned tables exist and which have no recipe | integration against the local Supabase stack with two real users | Testing SELECT only — a missing UPDATE or DELETE policy is the likelier defect and is invisible to a read-only assertion |
| #3 | A request carrying user A's session and user B's resource identifier returns not-found or forbidden and mutates nothing | "Middleware attaches the user, so the route is safe." Authentication is not authorization | Which routes accept a resource identifier; whether the ownership check lives in the route or is delegated entirely to RLS; what status a denied request returns | API-level integration | Asserting the status code alone — the test must also assert that the target row was not changed |
| #4 | Boundary inputs produce a defined, correct result: zero ketones, a day with no entries, and an entry at a day boundary | "The formula is one line, it cannot be wrong." The formula is fine; its edges are not | Where the calendar-day boundary is decided (client, server, or database); what happens when the divisor is zero; whether aggregation reads a calendar day or a rolling 24-hour span | unit (pure functions) | Copying the expected GKI from the implementation instead of computing it independently from PRD Business Logic rule 1 |
| #5 | Selecting a past date renders exactly that date's entries, and no mutation path is reachable from that view | "The UI hides the buttons, so it is read-only." Hidden is not unreachable | How the date parameter flows into the query; whether read-only is enforced server-side or only in the component | integration, plus one narrow e2e on the read-back flow | Snapshot and visual-diff tests (excluded by §7) — assert the returned data and the absence of a reachable mutation path instead |
| #6 | On a deliberately sparse window, the analysis output carries an explicit limitation or confidence statement rather than an unqualified cause | "The prompt instructs the model to hedge, so it hedges." Instruction is not compliance | The response contract — whether confidence is a structured field or free prose; what the endpoint does when the window is nearly empty | a deterministic assertion on a structured field if one exists; otherwise an AI-native rubric evaluation over recorded outputs | Layering a judge model over a property a deterministic field check already proves |
| #7 | An out-of-range or hostile N is rejected at the request boundary before any model call is made — and separately, that an in-range N cannot pull an unbounded payload into the prompt | "Validation is present, so N is bounded." Present is not bounded. Sharpened by Phase 1 research (2026-08-06): N *is* bounded (a three-literal enum), so the live challenge is the second one — "N is capped, so the request is capped." It is not: per-request payload is a separate axis | Grounded 2026-08-06. Rejection precedes both the model call and every DB read; the empty-window gate is a second real cost control; the open gaps are unbounded `health_goals` and absent `max_tokens` | unit on the request boundary, with an MSW tripwire at the network edge | Asserting the happy path N=14 only. Also: deriving the accepted values from `ANALYSIS_WINDOWS` — importing the constant the route validates against is a mirror test that widens when the constant widens. Hard-code 7/14/30. And assert exactly 400, not "not 200" — the `!supabase` 500 sits above validation and will pass a loose assertion for the wrong reason |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder via `/10x-new`. Status moves left-to-right through the values below; the orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Test-runner bootstrap and AI boundary | Prove a wrong-but-well-formed model value cannot silently persist, and that a hostile N is rejected before a model call | #1, #7 | unit + integration (stubbed model responses) | complete (2026-08-06 — 46 tests, 4 commits) | `context/changes/testing-runner-bootstrap-ai-boundary/` |
| 2 | Deterministic domain math | Prove GKI and daily macro totals are correct at their boundaries, not only on the happy path | #4 | unit | complete (2026-08-06 — 64 tests, 4 commits) | `context/changes/testing-deterministic-domain-math/` |
| 3 | Isolation and ownership as a gate | Prove neither the database nor the API hands one user another user's health data | #2, #3 | integration (local Supabase, two users) + API integration | not started | — |
| 4 | Read-back correctness | Prove the selected day is the day shown, and that past-day is read-only in fact rather than in appearance | #5 | integration + one narrow e2e | not started | — |
| 5 | Sparse-window hedging and gate wiring | Prove sparse-window analyses hedge as FR-012 requires, and lock the whole floor in CI | #6, cross-cutting | AI-native rubric evaluation over recorded outputs; gates | not started | — |

Status vocabulary (fixed): `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. AI-native tools carry a `checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | Vitest — checked: 2026-08-06 | ^4.1.10 | Hand-written `vitest.config.ts`, `environment: "node"`, does **not** call `getViteConfig()` (Cloudflare-adapter incompatibility on this repo's astro/adapter versions). `npm test` / `npm run test:watch`. See §6.1/§6.6 |
| model-response stubbing | MSW — checked: 2026-08-06 | ^2.15.0 | Network-edge stub via `setupServer`; one server covers OpenRouter and PostgREST (`createClient` injects no custom fetch). `onUnhandledRequest: "error"`. See §6.2 |
| database integration | local Supabase stack (Docker) | CLI ^2.23.4 | Already used for development (`npx supabase start` / `db reset`). Phase 3 makes it a test dependency rather than a manual one |
| SQL isolation recipes | hand-run psql scripts | n/a | Six recipes exist under `supabase/tests/`; they are re-runnable but manual and absent from CI. Phase 3 converts them into an automated gate |
| e2e | none yet — see §3 Phase 4 | — | Scoped to a single read-back flow. Do not expand to a full page-by-page suite |
| accessibility | none yet | — | No rollout phase owns this; not scoped in this rollout |
| (optional) AI-native | rubric evaluation over recorded analysis outputs — checked: 2026-08-03 | n/a | When NOT to use: if the analysis response exposes a structured confidence or limitation field, assert that field deterministically and skip the judge entirely. A judge over a field check is pure cost |
| (optional) AI-native | Chrome browser-automation MCP (`claude-in-chrome`) — checked: 2026-08-03 | n/a | Available in-session as a possible manual verification aid. When NOT to use: as an automated CI gate, or for anything the Phase 4 integration test already covers — it is non-deterministic and per-action expensive |

Tool names above are examples of their category, not endorsements.

**Stack grounding tools (current session):**
- Docs: none — no Context7 or framework-docs MCP is exposed in this session; stack facts came from local `package.json`, `astro.config.mjs`, `AGENTS.md`, and `tech-stack.md`; checked: 2026-08-03
- Search: web search / fetch available — not used for this write; the stack was fully determined from local manifests, so a runner-version check is deferred to Phase 1 research; checked: 2026-08-03
- Runtime/browser: `claude-in-chrome` MCP available — possible manual verification aid for Phase 4; not used as a gate; checked: 2026-08-03
- Provider/platform: none — no GitHub, Cloudflare, or Supabase MCP is exposed in this session; CI facts came from `.github/workflows/ci.yml`; checked: 2026-08-03

## 5. Quality Gates

The full set of gates that must pass before a change reaches production. "Required after §3 Phase N" means the gate is enforced once that rollout phase lands; before that, the gate is planned.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint | local + CI | required (wired today) | syntactic drift, `no-console` leaks, `astro/no-set-html-directive` violations |
| typecheck via `astro sync` + build | local + CI | required (wired today) | type drift and build-time breakage |
| unit + integration | local + CI | required after §3 Phase 1 | logic regressions; wrong-but-well-formed model output reaching persistence |
| domain-math boundary tests | local + CI | required after §3 Phase 2 | GKI and macro-aggregation errors at zero, empty, and day-boundary inputs |
| data-isolation suite | CI on PR | required after §3 Phase 3 | missing or mis-keyed row-level policies; ownership checks absent from the API layer |
| e2e on the read-back flow | CI on PR | required after §3 Phase 4 | a broken past-day critical path |
| sparse-window hedging check | CI on PR | required after §3 Phase 5 | an unhedged confident conclusion on insufficient data |
| post-edit hook | local (agent loop) | recommended local after §3 Phase 5 | regressions at edit time; never a substitute for the CI gates above |
| pre-prod smoke | between merge and prod | optional | Workers-runtime-specific failures that do not reproduce locally |

**A "required" gate is a target state, not proof of enforcement.** `.github/workflows/ci.yml` triggers on `master` while this repo's branch and default is `main`, so **no workflow runs on this repo today** — the "unit + integration required after §3 Phase 1" row above is real (`npm test` exists and passes, 46 tests) but not yet wired into CI. `/10x-plan` deliberately scoped that fix out of Phase 1 (adding a test step to a workflow that never fires would advertise a gate that doesn't execute); §3 Phase 5 owns the branch-trigger fix and gate wiring together.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the relevant rollout phase ships; before that, the sub-section reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Runner**: Vitest 4.1.10, `test.environment: "node"`, config at `vitest.config.ts` — hand-written, deliberately **not** built on Astro's `getViteConfig()`. That helper activates the Cloudflare adapter and `@cloudflare/vite-plugin`, incompatible with Vitest 4 on this repo's astro/adapter versions (withastro/astro#15878). The only cost is no `.astro` compilation and no `astro:*` virtual modules — `astro:env/server` is aliased to a stub (below); revisit if `.astro` rendering is ever needed.
- **Imports are explicit**: `import { describe, it, expect } from "vitest"` — `test.globals: false`, so no ambient globals.
- **Env stub**: `tests/stubs/astro-env.ts` mirrors `astro:env/server` (aliased in `vitest.config.ts`) as mutable `let` exports plus setter functions (`setOpenRouterApiKey`, etc.), reset to non-empty defaults in `afterEach` (`tests/setup.ts`). Services read these vars inside the function body, so the live ESM binding lets a test flip a value with a setter and see it on the next call — no `vi.resetModules()`.
- **Model output is asserted by rejection, not by value**: never assert a specific parsed value for a real (non-stubbed) description — the PRD accepts ±30–50% estimate inaccuracy, so that assertion only proves the stub came back. Two exceptions where asserting a value is legitimate: (a) the returned value literally *is* the stubbed value (proving pass-through, not model behaviour), and (b) the value comes from a domain law computed independently of the implementation (e.g. Atwater `9·fat + 4·protein + 4·carbs`), never from reading the parser.

### 6.2 Adding an integration test

- **Network-edge stubbing**: `tests/setup.ts` starts one MSW `setupServer` (from `msw/node`) with `onUnhandledRequest: "error"` — any outbound call a test didn't stub fails loudly. One server covers **both** OpenRouter and PostgREST traffic, because `createClient` (`src/lib/supabase.ts`) injects no custom `fetch` — `@supabase/ssr` falls through to global `fetch`, same as the OpenRouter call.
- **Handler factories**: `tests/helpers/msw.ts` — `openRouterSuccess/Failure/Malformed/Tripwire`, `postgrestRows/Tripwire`. Add new factories here rather than inlining `http.post(...)` boilerplate per test, unless a test needs to *capture* the request (URL, body) for assertion — those stay inline (see `tests/api/analysis.test.ts` 7.4/7.7 for the pattern).
- **The throwing-tripwire idiom, and its real behaviour**: install `openRouterTripwire()` / `postgrestTripwire()` when a test asserts "this call must not happen." Verified against `@mswjs/interceptors` source: a thrown resolver error does **not** reject `fetch()` — MSW converts it into a 500 response carrying `{name, message, stack}` as JSON. So the assertion that catches a firing tripwire is the *outcome* it produces (an unexpected status code, e.g. 500 instead of the expected 400/422), not a rejected promise. Still strictly better than counting lifecycle events: the failure's response body names itself.

### 6.3 Adding an e2e test

- TBD — see §3 Phase 4 for the past-day read-back pattern (selected date matches rendered data; no reachable mutation path).

### 6.4 Adding a test for a new API endpoint

- **Route harness**: Astro ships no official route-testing helper (the Container API's endpoint support is experimental) — import the route's exported `POST`/`GET` directly and call it with `buildApiContext()` (`tests/helpers/api-context.ts`). Supports a JSON `body`, a `rawBody` string (for malformed-JSON tests reaching a route's catch branch), and a `formBody` record (for routes reading `context.request.formData()`, e.g. the profile route). `cookies.set` is a no-op stub and `redirect` returns a real `Response` with a `Location` header — extend the harness, don't hand-roll a context object per test.
- **Request-boundary rejection pattern**: validate → reject *before* any DB read or model call. Assert the **exact** status code, never "not 200" — a `!supabase` 500 can sit above validation in a route and satisfy a loose assertion for the wrong reason (verified in `tests/api/analysis.test.ts`).
- **Hard-code accepted/rejected values — never import the constant the route validates against.** Importing (e.g.) `ANALYSIS_WINDOWS` into a test that locks its accepted set turns the lock into a mirror: widening the constant silently widens the test with it. Verified directly (Phase 1, 2026-08-06): temporarily widening `ANALYSIS_WINDOWS` to include `31` failed exactly the hard-coded `rejects window_days=31` case, with every other test unaffected — confirming the hard-coded list, not an imported one, is what makes the lock real.

### 6.5 Adding a test for a new user-owned table

- TBD — see §3 Phase 3 for how the existing hand-run isolation recipe becomes an automated per-table check covering all four operations, not SELECT alone.

### 6.6 Per-rollout-phase notes

**§3 Phase 1 (test-runner-bootstrap-ai-boundary, complete 2026-08-06):**

- **A schema-guard rejection costs exactly two model calls, not one.** The retry loop in `macros.ts`/`activity-estimate.ts`/`analysis.ts` treats any non-`OpenRouterError` as retryable — including a Zod/schema-guard failure — so one initial attempt plus one retry both fail identically before the route surfaces 422. When pinning this as a cost-control property (as `tests/api/meals.test.ts` and `tests/api/analysis.test.ts` 7.6 do), assert the exact call count; this is the licensed exception to "never assert model output by value or count" in §6.1, because the count *is* the property under test here, not an implementation detail being mirrored.
- **Tests cannot live under `src/pages/`.** Astro treats every `.ts` file there as a route — a colocated test file would become a live, unrouted endpoint at build time. The suite lives in a top-level `tests/` tree, mirroring `src/`'s structure (`tests/api/`, `tests/services/`, `tests/helpers/`, `tests/stubs/`).
- **DB CHECK constraints added alongside a Zod guard ship without an automated test in this rollout** (§3 Phase 1 shipped two: numeric ceilings on AI-derived macros/calories, and a length CHECK on `health_goals`). They're verified only by the migration applying cleanly (`npx supabase db reset`) — a deliberate, recorded risk accepted until §3 Phase 3 makes the local Supabase stack a test dependency.

**§3 Phase 2 (testing-deterministic-domain-math, complete 2026-08-06):**

- **`daySchema` is a private, per-route, duplicated Zod schema — not importable.** It lives inline in each of `meals/index.ts`, `biomarkers/index.ts`, `activities/index.ts`, and `analysis/index.ts` (byte-identical at time of writing), never exported. Pin its round-trip calendar-validity refine via the route harness (`buildApiContext` + the exported `GET`/`POST`), never by assuming it can be imported directly. One representative route's coverage is a deliberate cost×signal call, not an oversight — see `research.md` and `plan.md`'s "What We're NOT Doing" for the tradeoff.
- **The empty-day asymmetry between the single-day and range aggregation functions is intentional, not a bug — and now regression-locked.** `getDailyTotal`/`getDailyExpenditure` zero-fill an empty day (they're thin wrappers around `sumDailyTotal`/`sumDailyExpenditure`, testable as pure functions with `[]`); `listDailyTotals`/`listDailyExpenditure` omit it entirely from the range result (their grouping logic lives inside the async, DB-calling function, so proving the omission requires a route-level test with an MSW `postgrestRows` stub, not a pure-function call). Don't "fix" one to match the other without updating both the code comments (`src/types.ts:40` and the sibling doc comments) and the tests pinning each half.
- **GKI's div-by-zero guard lives entirely upstream of `computeGki`** — the function itself is an unguarded one-liner; the guard is a Zod `min(0.1)` floor stricter than the DB `CHECK (> 0)`. A pure-function test proves the formula; a separate route-level test (with a PostgREST tripwire) proves the guard actually rejects before persistence — one test cannot prove both halves of this property.
- **Leap-year gotcha for any future date-boundary test in this repo's current timeframe: 2026 is not a leap year** (2026 mod 4 = 2). Use `2024-02-29` (leap) / `2023-02-29` (not) for an accept/reject pair, not `2026-02-29`.
- **Mutation testing surfaced two real gaps a first pass of hand-written boundary tests missed**, both in the `Map`-based grouping loop shared by `listDailyTotals`/`listDailyExpenditure`: neither function's tests originally exercised *two rows landing on the same day within a range* — a mutant that always took the "new day" branch of the grouping `if` survived because every range fixture used one row per day, so the accumulate-vs-overwrite branch was never distinguished. Also, the leap-day accept-path test asserted only `response.status === 201`, not the returned `total`, so a fully gutted `getDailyTotal` still passed. Both fixed by strengthening the existing tests, not by adding new files — a reminder that a green suite proves coverage, not precision; mutation testing is what catches the difference. Scoped run: `npx stryker run` (config: `stryker.config.json`, mutates only `biomarkers.ts`/`meals.ts`/`activities.ts`). 22 mutants remained deliberately unaddressed after triage — query-builder string args (`.select("day, ...")` → `""`) and ordering-direction args (`{ ascending: true }` → `{}`), which the hermetic MSW stub can't distinguish since it ignores query params entirely (would need a real-Supabase integration test, §3 Phase 3's territory, to close); and `if (error)` DB-failure branches, which are an error-handling robustness question orthogonal to this phase's boundary-correctness scope. None of the 22 represent an unguarded Risk #4 boundary.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout. Future contributors should respect these unless the underlying assumption changes.

- **Live model calls inside the suite** — the suite runs against stubbed or recorded responses; live-model output quality is judged manually, per the PRD's own subjective evaluation standard for the analysis feature. Re-evaluate if a model or prompt change starts shipping without any manual review. (Source: Phase 2 interview Q5.)
- **UI snapshot and visual-diff tests** — chart and component snapshots break on styling changes and rarely catch a real defect; assert the data that feeds the chart instead. Re-evaluate if a rendering regression ever reaches production. (Source: Phase 2 interview Q5.)
- **Sign-in, sign-up, and sign-out flows** — Supabase Auth owns the mechanism and these routes are thin and stable (2 commits each in 90d). Note the boundary: this excludes the *login flow*, not *authorization*. Risks #2 and #3 — data isolation and record ownership — remain fully in scope, because the PRD names data isolation as a hard guardrail and it is a different property from login working. Re-evaluate if the auth routes gain custom logic beyond delegating to the provider. (Source: Phase 2 interview Q5.)
- **shadcn/ui primitives and upstream framework code** — `src/components/ui/` is vendored, and Astro, Supabase, and Zod are upstream's responsibility. Re-evaluate if a vendored primitive is modified locally. (Source: `AGENTS.md` conventions; consistent with Phase 2 interview Q5.)
- **Rate limiting on the analysis endpoint** — no rate limiter exists today (recorded as finding F1 in `context/archive/2026-08-01-on-demand-ai-analysis/reviews/impl-review.md` and deliberately deferred), so there is nothing to test. Risk #7 covers the abuse surface that does exist — and Phase 1 research (2026-08-06) narrowed what that is: not the N parameter, which is a bounded enum, but the per-request payload N does not constrain (unbounded `health_goals`, absent `max_tokens`). Note this makes impl-review F1 a weaker source for risk #7 than it first appeared: F1's actual concern is repeated clicks, which is exactly what this exclusion covers. Re-evaluate when a rate limiter is built, or when real usage makes spend a live concern.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-03
- Stack versions last verified: 2026-08-03
- AI-native tool references last verified: 2026-08-03

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
