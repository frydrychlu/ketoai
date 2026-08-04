# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-03

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
| 1 | An AI-parsed macro or activity estimate is wrong but well-formed, passes validation, persists, and silently corrupts every daily total, trend, and analysis built on it | High | High | interview Q1 (top stated worry); interview Q3 (AI service layer named low-confidence); PRD FR-004 and FR-005 Socrates notes ("error-prone and poisons downstream metrics"); hot-spot dir `src/lib/services/` — 18 commits/90d; `context/archive/2026-06-09-meal-macro-logging/reviews/impl-review.md` (schema `min(0)` is the only guard; the column accepts negatives) |
| 2 | One user's health data becomes readable by another user through a mis-set or missing row-level policy on a newly added table | High | Medium | PRD §Non-Functional Requirements, §Success Criteria/Guardrails, Business Logic rule 4 (hard guardrail); `AGENTS.md` hard rule (RLS with four granular per-operation policies per table); hot-spot dirs `supabase/migrations/` — 8 commits/90d and `supabase/tests/` — 6 commits/90d; isolation verification exists only as a hand-run recipe and is absent from CI |
| 3 | An authenticated user reads or mutates a record belonging to someone else — the endpoint checks *logged in*, not *yours* | High | Medium | PRD §Access Control ("every authenticated user accesses only their own data"; flat role model); hot-spot dir `src/pages/api/` — 20 commits/90d (top directory); abuse lens — authorization / ownership class |
| 4 | A daily macro total or GKI value is plausible but wrong at a boundary — zero ketones, a day with no entries, or an entry landing on the wrong calendar day | High | Medium | PRD Business Logic rules 1 and 2 (explicit formulas); PRD FR-006 Socrates resolution (units fixed; GKI never user-entered); hot-spot dirs `src/lib/services/` — 18 commits/90d and `src/pages/` — 15 commits/90d; interview Q3 |
| 5 | The past-day view shows the wrong day's data, or exposes a create / edit / delete affordance that US-02 forbids | Medium-High | High | PRD US-02 acceptance criteria and FR-011; hot-spot dir `src/components/history/` — 5 commits/30d (hottest recent window); hot-spot dir `src/pages/` — 15 commits/90d; interview Q3 (dashboard and charts named low-confidence) |
| 6 | The analysis states a confident cause on a sparse window instead of hedging, and the user changes their diet on it | Medium-High | Medium | PRD FR-012 and its Socrates resolution ("must state its confidence level and data limitations explicitly"); Business Logic rule 3; roadmap S-09 Unknowns — how the sparse-window hedging contract is enforced was deferred to planning and never recorded as resolved; hot-spot dir `src/components/analysis/` — new in the 30d window |
| 7 | An unbounded or oversized N-day window turns one analysis request into unbounded prompt size, work, and spend on a free-tier runtime | Medium | Medium | PRD FR-012 (N is a user-set parameter); `context/archive/2026-08-01-on-demand-ai-analysis/reviews/impl-review.md` finding F1 (no rate limiting; explicitly deferred); abuse lens — untrusted-input and resource-abuse classes; `tech-stack.md` (Cloudflare Workers free tier, `has_ai: true`) |

High-impact × Low-likelihood scenarios were considered and deliberately left out of the map: a Supabase or Cloudflare outage, and an OpenRouter provider outage. These are observability and alerting concerns, not test targets — a test cannot prevent them and asserting on them only mirrors the implementation.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | A model response that is well-formed but nutritionally implausible or out of range is rejected or flagged — it never becomes a persisted row | "It passed schema validation, so it is correct." Schema-valid is not the same as plausible | The parse → validate → persist path; where the validation boundary sits; what the database accepts versus what the schema accepts; how a rejection surfaces to the user | unit + integration against stubbed model responses | The oracle problem — deriving the expected macros by reading what the parser currently returns. Expected values must come from the meal description, not from the code under test |
| #2 | A second user's authenticated session reads zero rows of the first user's data, across every user-owned table and every operation | "RLS is enabled, so the table is isolated." Enabled is not the same as four correct policies | How the SSR client binds the authenticated identity to a query; what the existing canary recipe actually asserts; which user-owned tables exist and which have no recipe | integration against the local Supabase stack with two real users | Testing SELECT only — a missing UPDATE or DELETE policy is the likelier defect and is invisible to a read-only assertion |
| #3 | A request carrying user A's session and user B's resource identifier returns not-found or forbidden and mutates nothing | "Middleware attaches the user, so the route is safe." Authentication is not authorization | Which routes accept a resource identifier; whether the ownership check lives in the route or is delegated entirely to RLS; what status a denied request returns | API-level integration | Asserting the status code alone — the test must also assert that the target row was not changed |
| #4 | Boundary inputs produce a defined, correct result: zero ketones, a day with no entries, and an entry at a day boundary | "The formula is one line, it cannot be wrong." The formula is fine; its edges are not | Where the calendar-day boundary is decided (client, server, or database); what happens when the divisor is zero; whether aggregation reads a calendar day or a rolling 24-hour span | unit (pure functions) | Copying the expected GKI from the implementation instead of computing it independently from PRD Business Logic rule 1 |
| #5 | Selecting a past date renders exactly that date's entries, and no mutation path is reachable from that view | "The UI hides the buttons, so it is read-only." Hidden is not unreachable | How the date parameter flows into the query; whether read-only is enforced server-side or only in the component | integration, plus one narrow e2e on the read-back flow | Snapshot and visual-diff tests (excluded by §7) — assert the returned data and the absence of a reachable mutation path instead |
| #6 | On a deliberately sparse window, the analysis output carries an explicit limitation or confidence statement rather than an unqualified cause | "The prompt instructs the model to hedge, so it hedges." Instruction is not compliance | The response contract — whether confidence is a structured field or free prose; what the endpoint does when the window is nearly empty | a deterministic assertion on a structured field if one exists; otherwise an AI-native rubric evaluation over recorded outputs | Layering a judge model over a property a deterministic field check already proves |
| #7 | An out-of-range or hostile N is rejected at the request boundary before any model call is made | "Validation is present, so N is bounded." Present is not bounded | Whether N carries a minimum and maximum; whether the window is capped server-side; whether a rejected request still costs a model call | unit + integration on the request boundary | Asserting the happy path N=14 only — the defect lives at N=0, at very large N, and at non-numeric input |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder via `/10x-new`. Status moves left-to-right through the values below; the orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Test-runner bootstrap and AI boundary | Prove a wrong-but-well-formed model value cannot silently persist, and that a hostile N is rejected before a model call | #1, #7 | unit + integration (stubbed model responses) | change opened | `context/changes/testing-runner-bootstrap-ai-boundary/` |
| 2 | Deterministic domain math | Prove GKI and daily macro totals are correct at their boundaries, not only on the happy path | #4 | unit | not started | — |
| 3 | Isolation and ownership as a gate | Prove neither the database nor the API hands one user another user's health data | #2, #3 | integration (local Supabase, two users) + API integration | not started | — |
| 4 | Read-back correctness | Prove the selected day is the day shown, and that past-day is read-only in fact rather than in appearance | #5 | integration + one narrow e2e | not started | — |
| 5 | Sparse-window hedging and gate wiring | Prove sparse-window analyses hedge as FR-012 requires, and lock the whole floor in CI | #6, cross-cutting | AI-native rubric evaluation over recorded outputs; gates | not started | — |

Status vocabulary (fixed): `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. AI-native tools carry a `checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | none yet — see §3 Phase 1 | — | Zero test files and no runner config today. Phase 1 selects and wires the runner; a Vite-native runner is the obvious candidate given the Astro/Vite toolchain, but the choice belongs to Phase 1's research |
| model-response stubbing | none yet — see §3 Phase 1 | — | Required by §7 (no live model calls in the suite). Stub at the network edge, not by mocking internal service modules |
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

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the relevant rollout phase ships; before that, the sub-section reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

- TBD — see §3 Phase 1 for the runner choice and the wrong-but-well-formed model value rejection pattern; §3 Phase 2 extends this with the boundary pattern for GKI and macro aggregation (zero divisor, empty day, day boundary).

### 6.2 Adding an integration test

- TBD — see §3 Phase 1 for the stubbed-model-response pattern at the network edge, and §3 Phase 3 for the two-user isolation pattern against the local Supabase stack.

### 6.3 Adding an e2e test

- TBD — see §3 Phase 4 for the past-day read-back pattern (selected date matches rendered data; no reachable mutation path).

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 3 for the ownership pattern (user A's session against user B's resource identifier returns a denial and mutates nothing) and §3 Phase 1 for the request-boundary rejection pattern for out-of-range parameters.

### 6.5 Adding a test for a new user-owned table

- TBD — see §3 Phase 3 for how the existing hand-run isolation recipe becomes an automated per-table check covering all four operations, not SELECT alone.

### 6.6 Per-rollout-phase notes

(Filled in by `/10x-implement` after each phase lands.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout. Future contributors should respect these unless the underlying assumption changes.

- **Live model calls inside the suite** — the suite runs against stubbed or recorded responses; live-model output quality is judged manually, per the PRD's own subjective evaluation standard for the analysis feature. Re-evaluate if a model or prompt change starts shipping without any manual review. (Source: Phase 2 interview Q5.)
- **UI snapshot and visual-diff tests** — chart and component snapshots break on styling changes and rarely catch a real defect; assert the data that feeds the chart instead. Re-evaluate if a rendering regression ever reaches production. (Source: Phase 2 interview Q5.)
- **Sign-in, sign-up, and sign-out flows** — Supabase Auth owns the mechanism and these routes are thin and stable (2 commits each in 90d). Note the boundary: this excludes the *login flow*, not *authorization*. Risks #2 and #3 — data isolation and record ownership — remain fully in scope, because the PRD names data isolation as a hard guardrail and it is a different property from login working. Re-evaluate if the auth routes gain custom logic beyond delegating to the provider. (Source: Phase 2 interview Q5.)
- **shadcn/ui primitives and upstream framework code** — `src/components/ui/` is vendored, and Astro, Supabase, and Zod are upstream's responsibility. Re-evaluate if a vendored primitive is modified locally. (Source: `AGENTS.md` conventions; consistent with Phase 2 interview Q5.)
- **Rate limiting on the analysis endpoint** — no rate limiter exists today (recorded as finding F1 in `context/archive/2026-08-01-on-demand-ai-analysis/reviews/impl-review.md` and deliberately deferred), so there is nothing to test. Risk #7 covers the abuse surface that does exist: an unbounded N parameter. Re-evaluate when a rate limiter is built, or when real usage makes spend a live concern.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-03
- Stack versions last verified: 2026-08-03
- AI-native tool references last verified: 2026-08-03

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
