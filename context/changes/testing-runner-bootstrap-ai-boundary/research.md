---
date: 2026-08-04T18:20:00+02:00
researcher: lfrydrych
git_commit: 548d7c5b4d694a908df526a1fb36c7c1656e1e1f
branch: main
repository: frydrychlu/ketoai
topic: "Risk #1 — an AI-parsed macro or activity estimate is wrong but well-formed, passes validation, and silently corrupts every downstream metric"
tags: [research, codebase, testing, ai-boundary, macros, activity-estimate, vitest, msw, oracle]
status: complete
last_updated: 2026-08-06
last_updated_by: lfrydrych
last_updated_note: "Added second research pass — risk #7 (N-day window bound on the analysis endpoint)"
---

# Research: Risk #1 — wrong-but-well-formed AI values reaching persistence

**Date**: 2026-08-04T18:20:00+02:00
**Researcher**: lfrydrych
**Git Commit**: `548d7c5b4d694a908df526a1fb36c7c1656e1e1f`
**Branch**: `main`
**Repository**: frydrychlu/ketoai

## Research Question

From `context/foundation/test-plan.md` §3 Phase 1, risk #1:

> An AI-parsed macro or activity estimate is wrong but well-formed, passes validation, persists, and silently corrupts every daily total, trend, and analysis built on it.

Scope agreed with the user before research: **risk #1 only** (risk #7, the unbounded `N`, needs its own pass), **plus** the test-runner and model-stubbing selection that §4 assigns to this phase.

## Summary

**The risk is confirmed end to end, and it is worse than the risk map states — but for a different reason than the map cites.**

Three findings dominate:

**1. The oracle for this risk is not "correct macros."** It cannot be. The PRD explicitly accepts inaccuracy: FR-005's Socrates note resolves "estimates are ±30–50% inaccurate" with *"kept; estimates are labeled as approximate."* Any test asserting that a described meal yields particular macro values would be asserting against a stub the test itself wrote — the textbook mirror test. The real oracle is a different question: **which model outputs must the system refuse to persist?** That question *is* answerable from sources, and today the answer the code gives is "none — every finite non-negative number is accepted."

**2. The risk map's cited evidence is stale; the risk survives, relocated.** §2 cites the archive finding that "the column accepts negatives." That was fixed on 2026-06-20 by `20260620075537_meals_macro_nonneg.sql`, and `activities` shipped with the guard from birth. The floor is closed on both tables. The actual gap is the **ceiling**, which was never raised, deferred, or accepted in any review — it is unexamined, not known. Per §1 principle #3, research is ground truth where it disagrees with the plan.

**3. The asymmetry that names the defect:** every user-typed numeric in this codebase is bounded on both ends; every AI-derived numeric is bounded only below.

| Field | Provenance | Constraint |
|---|---|---|
| `ketones_mmol_l` | user-typed | `.min(0.1).max(20)` |
| `glucose_mg_dl` | user-typed | `.int().min(20).max(600)` |
| `weight_kg` | user-typed | `.min(20).max(500)` |
| `water_liters` | user-typed | `.min(0).max(20)` |
| mood/energy/sleep ratings | user-typed | `.int().min(1).max(10)` |
| `meals.fat_g / protein_g / carbs_g / calories_kcal` | **model-generated** | `.min(0)` — no ceiling |
| `activities.calories_kcal` | **model-generated** | `.min(0)` — no ceiling |

The ceiling is missing exactly where the value's provenance is least trustworthy. A model returning `calories_kcal: 999999` clears Zod, clears the Postgres CHECK, and is written verbatim.

Corruption chain, confirmed by reading it through: `macros.ts` → `meals` row → `sumDailyTotal` → `listDailyTotals` → the trends dashboard *and* `analysis.ts:43,120`, which feeds those totals into the FR-012 analysis prompt. One bad number poisons the daily summary, the chart, and the AI's own reasoning context. Nothing revalidates on read at any hop.

**Consequence for planning:** Phase 1 splits into tests that have a sound oracle today, and tests that require a product decision first (see [Open Questions](#open-questions)). That decision is a blocker for roughly half the phase, and it is the user's to make.

## Detailed Findings

### The meal path (FR-004) — parse → validate → persist

Call chain: `MealLogger.tsx:59` → `POST /api/meals` (`meals/index.ts:98`) → `parseMealToMacros` (`macros.ts:56`) → OpenRouter → Zod → insert (`meals/index.ts:139-143`).

**Transport.** Bare global `fetch`, no SDK (`macros.ts:78`), to `https://openrouter.ai/api/v1/chat/completions` (`macros.ts:11`), model `anthropic/claude-haiku-4.5` (`macros.ts:18`), `temperature: 0`. Key from `astro:env/server`, declared `optional: true` at `astro.config.mjs:21`.

**The validation boundary.** `macro-schema.ts:11-16`, verbatim:

```ts
export const macroResultSchema = z.object({
  fat_g: z.number().min(0),
  protein_g: z.number().min(0),
  carbs_g: z.number().min(0),
  calories_kcal: z.number().min(0),
});
```

No `.max()`, no `.int()`, no `.finite()`. `z.object` is non-strict — extra model keys are silently stripped. The paired structured-output schema sent to the model (`macro-schema.ts:26-40`) has `strict: true` and `additionalProperties: false`, but **no `minimum` or `maximum`** — the model is never told the value must be non-negative, let alone bounded.

**No plausibility layer exists.** Stated explicitly, because its absence is the finding:

- No Atwater consistency check (`calories ≈ 9·fat + 4·protein + 4·carbs`). The four fields are physiologically redundant, so a hallucination is *detectable by arithmetic*. The signal is present and unused. There is no such arithmetic anywhere in `src/`.
- No upper bound at any layer — Zod, JSON schema, or DB.
- No `.max()` on the meal `description` (`meals/index.ts:22` is `.trim().min(1)` only), so unbounded user text — including prompt-injection text — is forwarded verbatim as the user message.

**No confirmation step.** The model's output is spread straight into the insert with no clamping, rounding, or review (`meals/index.ts:141`):

```ts
.insert({ user_id: user.id, description, day, ...macros })
```

The user never sees the macros before they are saved. And `meals/[id].ts` exports only `DELETE` — there is **no edit endpoint**, so a user who spots an absurd number can only delete the whole meal and retype it. (An unused `meals_update_own` RLS policy exists at `20260615182411_meals.sql:48-53`.)

**Failure path.** Malformed JSON, Zod rejection, network error, and 5xx all funnel through one retry (`macros.ts:64-73`, 300 ms delay) into `MacroParseError`, which the route maps to **HTTP 422** with the Polish message *"Nie udało się rozpoznać makroskładników. Spróbuj opisać posiłek inaczej."* (`meals/index.ts:129-134`). Nothing is persisted — the insert is downstream of the throw. Nothing is logged; the `cause` chain is discarded.

**Known misclassification:** a missing `OPENROUTER_API_KEY` also produces that 422 (`macros.ts:57-59`). A server misconfiguration is reported to the user as bad input. Already flagged and skipped in the archive review; still present in both AI paths.

**Nothing revalidates on read.** `meals.ts:8-18` is pure addition over whatever the DB returns. `meals/index.ts:87` uses `.overrideTypes<Meal[]>()` — a compile-time assertion with no runtime check.

### The activity path (FR-005) and its asymmetries

`activity-estimate.ts` is a near-verbatim copy of `macros.ts` (identical endpoint, model, error class, retry loop, extraction helper) — the module comment says so outright. Error handling, status codes, persistence-on-failure, and the missing logging are **fully symmetric**; I note that so planning doesn't chase phantom differences. Four differences do matter:

**A. The schema's guarantee is discarded.** `macros.ts:110` returns the whole validated object; `activity-estimate.ts:109` unwraps to a bare `number`. `ActivityEstimateResult` is exported and has no consumer anywhere in `src/`. The activity path has no DTO to assert against — only a float.

**B. The activity estimate is structurally unfalsifiable.** The meal path has four correlated numbers and therefore an available cross-check. `activityEstimateResultSchema` has *one* number with no correlate, and the only external anchor — body weight — is never fetched. `estimateActivityCalories(description: string)` takes a string and nothing else; the route never imports the profile service. **A 50 kg and a 120 kg user logging the same activity get the identical estimate.** The codebase already has the profile-fetch pattern (`analysis.ts:43-49` calls `getProfile`), it just isn't used here.

Note precisely what this is and isn't: FR-005 does not require the profile to feed the estimate, so this is a plausibility gap, **not a spec violation**. The prompt itself encodes the choice — *"na podstawie typowych wartości"* (typical values).

**C. A required prompt input is never validated.** The activity system prompt (`activity-estimate.ts:45-46`) instructs the model to estimate *"oraz czasu trwania podanego w opisie"* — from the duration given in the description. Nothing checks that a duration is present. `"bieganie"` with no duration silently yields an invented duration, and the resulting kcal is indistinguishable from a good one. The meal prompt has no equivalent hidden dependency.

**D. Presentation hedges; data does not.** The activity UI honours FR-005's "approximate" requirement visually — `~` and "(estimate)" (`ActivityLogger.tsx:96-97,153`). But the stored number carries no approximation marker, and `analysis.ts:46` feeds raw totals to the AI with no hedge. That is precisely the failure mode FR-005's Socrates note raised.

### What each layer accepts

| Field | Zod accepts | Postgres accepts | Verdict |
|---|---|---|---|
| all four `meals` macro columns | finite, ≥ 0, no ceiling | `numeric` ≥ 0, **incl. NaN/Infinity**, no ceiling | Zod stricter on special values; **both share the missing ceiling** |
| `activities.calories_kcal` | same | same | same |

All columns are unqualified `numeric` — unbounded precision, full decimal fidelity, no truncation, no float drift.

Two secondary notes, both correctly caveated by the research agent rather than asserted:

- Postgres accepts `'NaN'::numeric` and `'Infinity'::numeric`, and NaN sorts *above* all non-NaN values, so both satisfy `>= 0`. This is documented Postgres 17 behaviour, **not verified against this repo's DB** (Docker was not running). It is unreachable through the app — `supabase-js` JSON-serialises `NaN`/`Infinity` to `null`, which trips `NOT NULL` — but open to psql, the cloud SQL editor, and the seed scripts.
- Both tables carry live `*_update_own` RLS policies that **no application code uses**. A holder of a valid user JWT plus the anon key could `PATCH` their own row to any value ≥ 0, with the CHECK as the sole validator and Zod never executing. Mitigating: `SUPABASE_KEY` is server-only per the README, so this is not a trivially reachable surface — but it is the concrete answer to "a bad value entering by a path other than the validated one."

One practical detail for test authors: the `meals` constraints are **named** (`meals_fat_g_nonneg`, …); the `activities` one is anonymous and Postgres will auto-name it `activities_calories_kcal_check`. Do not assume a shared naming convention.

### The oracle — what can and cannot be asserted

This is the section that should drive `/10x-plan`.

**Sound oracle available today** (derived from PRD, domain law, or the HTTP contract — never from reading the parser):

| # | Property to assert | Oracle source |
|---|---|---|
| 1 | A model response that fails the schema (missing key, string, `null`, negative) results in 422 and **zero rows written** | PRD NFR "persisted at the moment of submission… no intermediate draft state"; negative mass is physically impossible |
| 2 | A model transport failure (5xx, network error) never produces a persisted row | same |
| 3 | A transient 5xx that succeeds on retry surfaces as success, not as user error | observable contract; see mirror-test caveat below |
| 4 | The request actually sent carries the FR-004 unit contract — grams for macros, kcal for energy, `strict` structured output | FR-004 + FR-006 unit fixing |
| 5 | The daily total is the arithmetic sum of persisted meal rows | Business Logic rule 2 (verbatim: "the arithmetic sum") |
| 6 | A missing `OPENROUTER_API_KEY` is a **server** fault, not a 4xx client fault | HTTP semantics; currently returns 422 — this test fails against current code |

**Mirror-test caveat on #3:** asserting "exactly 2 requests on 5xx, exactly 1 on 4xx" reads the retry count out of `macros.ts:64-73`. Assert the *user-visible outcome* (transient failure recovers; permanent failure surfaces once) rather than the count, unless the count is being pinned deliberately as a cost-control property — which belongs with risk #7.

**No oracle in sources — blocked on a decision** (see Open Questions): any upper bound, any Atwater tolerance, whether the profile should feed the activity estimate, any description length cap.

**The trap to name explicitly in the plan:** a test of the form `expect(macros).toEqual({ fat_g: 12, … })` against a stubbed response asserts nothing about the system — it asserts that the stub the test wrote came back. Every valuable assertion here is about the *boundary behaviour*, not the values.

### Runner and stubbing

**Recommendation: Vitest 4.1.10, `environment: "node"`, with a hand-written `vitest.config.ts` that does NOT call `getViteConfig()`.**

`getViteConfig` is still exported by the installed Astro 6.3.1 and still documented — but it runs `runHookConfigSetup`, which activates the Cloudflare adapter and injects `@cloudflare/vite-plugin`, which is fundamentally hostile to Vitest 4. [withastro/astro#15878](https://github.com/withastro/astro/issues/15878) documents a "multi-layered fundamental incompatibility"; it was fixed by [PR #17248](https://github.com/withastro/astro/pull/17248) on 2026-07-02. **This project sits on the pre-fix versions** — astro 6.3.1 and @astrojs/cloudflare 13.5.0 both published 2026-05-07, and the installed adapter dist contains neither the fix hook nor a `VITEST` guard. Latest are astro 7.1.6 / adapter 14.1.7, a major-version jump not worth taking on for a runner decision.

The recommended config sidesteps the question entirely by never loading the adapter, so the recommendation holds whether or not the incompatibility reproduces on this exact install. (The agent flagged this as inference — it did not install Vitest to reproduce, correctly, since that would modify the project.)

**`@cloudflare/vitest-pool-workers` is not needed.** `wrangler.jsonc` declares only an `ASSETS` binding and `nodejs_compat` — no KV, D1, R2, or Durable Objects — and nothing in `src/lib/services/` or `src/pages/api/` touches a Workers-runtime API. It would also drag the CF plugin back in.

**Cost of not using `getViteConfig`:** no `.astro` compilation and no `astro:*` virtual modules. For risk #1's scope that is nearly free — the only Astro coupling is `astro:env/server`, imported by exactly five files. One alias replaces it. Revisit if `.astro` component rendering is ever needed, and upgrade Astro first.

**Stubbing: MSW 2.15.0**, because the app calls global `fetch` directly with no abstraction. An interceptor sees the real `Request` — URL, method, `Authorization` header, JSON body — so tests can assert *what prompt was actually sent*, not merely that a function was called. `vi.stubGlobal` is cheaper but hands back a fake `fetch`, which is the mock-the-internals shape §4 tells us to avoid. Vitest's own docs recommend MSW. Run with `onUnhandledRequest: "error"` so an unstubbed outbound call fails the test rather than hitting the network.

For "no model call was made" (needed for risk #7), prefer a tripwire handler that throws over counting lifecycle events — the failure then names itself.

**Running route handlers:** there is no official Astro helper. The Container API supports `routeType: "endpoint"` but is explicitly experimental. The norm is importing the exported `POST`/`GET` and hand-building a minimal `APIContext`. The routes touch only `context.locals.user`, `context.request`, and `context.cookies`; `env.d.ts` types `locals.user` as `User | null`, and routes read only truthiness and `user.id`. A `{ id }` stub plus a cast suffices.

**Env stub — one non-obvious detail worth keeping:** the services read `OPENROUTER_API_KEY` *inside* the function body, so an `astro:env/server` stub using `export let` + a setter lets a test flip the value via ESM live bindings without `vi.resetModules()`. That makes the "key not configured" branch trivially testable.

**CI, and a problem that makes the whole gate moot:** `.github/workflows/ci.yml:5,7` triggers on `branches: [master]`, but this repo's branch — and its default — is **`main`**. As written, **CI never runs.** Adding `npm run test` to that workflow would add a decorative gate. Verified directly: the workflow file says `master`; `git branch --show-current` says `main`. This should be fixed as part of Phase 1, or the quality gate §5 promises does not exist.

Node-environment unit tests need no secrets — the env stub supplies them — so the test step can run without `SUPABASE_URL`/`SUPABASE_KEY`.

## Code References

- [`src/lib/services/macros.ts:78-93`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/services/macros.ts#L78-L93) — the OpenRouter `fetch`; the stub boundary
- [`src/lib/services/macros.ts:43-50`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/services/macros.ts#L43-L50) — system prompt; states units and scope, says nothing about ranges or plausibility
- [`src/lib/services/macros.ts:64-73`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/services/macros.ts#L64-L73) — retry loop; non-`OpenRouterError` defaults to retryable, so Zod failures are retried
- [`src/lib/services/macro-schema.ts:11-16`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/services/macro-schema.ts#L11-L16) — the entire runtime guard on model output
- [`src/lib/services/macro-schema.ts:26-40`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/services/macro-schema.ts#L26-L40) — structured-output schema; no `minimum`/`maximum` communicated to the model
- [`src/pages/api/meals/index.ts:127-143`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/pages/api/meals/index.ts#L127-L143) — parse, 422 branch, and the unmediated `...macros` insert
- [`src/lib/services/activity-estimate-schema.ts:12-14`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/services/activity-estimate-schema.ts#L12-L14) — one number, `min(0)`, no correlate
- [`src/lib/services/activity-estimate.ts:56`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/services/activity-estimate.ts#L56) — signature takes only a description; no profile input
- [`src/lib/services/meals.ts:8-18`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/services/meals.ts#L8-L18) — `sumDailyTotal`; pure addition, no revalidation on read
- [`src/lib/services/analysis.ts:43`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/services/analysis.ts#L43) — daily totals enter the AI analysis prompt; the corruption chain's last hop
- [`src/pages/api/biomarkers/index.ts:25-26`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/pages/api/biomarkers/index.ts#L25-L26) — the bounding convention AI values do not follow
- [`supabase/migrations/20260620075537_meals_macro_nonneg.sql:7-11`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/supabase/migrations/20260620075537_meals_macro_nonneg.sql#L7-L11) — the floor, retrofitted; no ceiling
- [`supabase/migrations/20260630120000_activities.sql:24`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/supabase/migrations/20260630120000_activities.sql#L24) — same floor, inline, anonymous constraint
- [`.github/workflows/ci.yml:5-7`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/.github/workflows/ci.yml#L5-L7) — triggers on `master`; the branch is `main`

## Architecture Insights

- **The two AI services are copy-paste twins.** `activity-estimate.ts` is `macros.ts` minus three fields. Any guard added to one must be added to the other, and a shared boundary helper is the obvious refactor — but note that hoisting it changes the stub seam, so decide before writing tests, not after.
- **The codebase already knows how to constrain a model.** `analysis-schema.ts:9-11` requires `confidence` and `data_limitations` *"so the model cannot omit the FR-012 hedge."* A deliberate semantic guard exists in the third AI path. Neither numeric path has an analogue — this is inconsistency, not ignorance, and it is a usable precedent.
- **Validation tightened where input was cheap to distrust, and not where it was expensive.** The archive shows `day` being hardened with a calendar round-trip check *specifically* so a bad value never reaches the LLM call — while the model-supplied fields in the same change were left at `min(0)`.
- **The `numeric` type decision hid the ceiling question.** Archive finding F10 dismissed DB bounds with *"no real overflow risk from numeric."* True about storage, silent about plausibility — and that sentence is what closed the door on ever asking for an upper bound.

## Historical Context (from prior changes)

- `context/archive/2026-06-09-meal-macro-logging/plan.md:132` — the plan's own contract required *"Numbers finite and non-negative."* Only half shipped initially.
- `.../reviews/impl-review.md:124-132` (**F10**, OBSERVATION) — no DB non-negative guard. **FIXED** by `20260620075537`, verified locally 2026-06-20. This is the finding `test-plan.md` §2 cites as current evidence; it is now stale.
- `.../reviews/impl-review.md:64-72` (**F4**, OBSERVATION) — `.finite()` not enforced; *"Infinity could be persisted."* **SKIPPED** as low risk. **The premise is factually wrong for the installed Zod 4.4.3**, whose number check requires `Number.isFinite`. The skip reached the right outcome by wrong reasoning — and the wrong reasoning is what a future reader inherits, so someone may "fix" a non-problem while the real gap stays invisible.
- `.../reviews/impl-review.md:80` (**F5**) — config fault surfacing as a 422 client error. Skipped; still present in both AI paths.
- `context/archive/2026-06-30-activity-logging/reviews/impl-review.md` — APPROVED, 0 critical. Neither finding concerns numeric validation; the `>= 0` CHECK was recorded as satisfactory and the review moved on.

**Net:** an upper bound on any AI-derived numeric was never raised, deferred, or accepted in any review or plan across both features. It is an unexamined gap.

## Related Research

- `context/archive/2026-08-01-on-demand-ai-analysis/reviews/impl-review.md` — finding F1 (no rate limiting, deferred) is the origin of risk #7, the other half of this rollout phase. Read before researching #7.
- `context/foundation/test-plan.md` §2 Risk Response Guidance, row #1 — anticipated the oracle problem correctly: *"Expected values must come from the meal description, not from the code under test."* This research narrows that further: expected *values* are not assertable at all; expected *rejections* are.

## Open Questions

These block roughly half of Phase 1. Sources do not resolve them, so per the oracle rules they are asked rather than guessed.

**Q1 — Should an implausible-but-well-formed model value be rejected, and at what threshold?** No source gives a number. The repo's own precedent (every user-typed physiological value is bounded) argues for a bound; the PRD's acceptance of ±30–50% inaccuracy argues the bound must be loose enough not to reject legitimately imprecise estimates. My recommendation: an order-of-magnitude sanity ceiling — reject rather than flag, since there is no edit endpoint to correct a flagged row.

**Q2 — Should the meal path enforce Atwater consistency (`calories ≈ 9·fat + 4·protein + 4·carbs`)?** This is the strongest available oracle: an external domain law that derives the expected value from *other fields*, so it cannot mirror the implementation. Two real caveats to weigh before adopting it: the prompt asks for *total* carbs, and fibre yields ~2 kcal/g rather than 4; and alcohol (7 kcal/g) is not represented in any of the four fields at all. A tight equality check would therefore reject legitimate high-fibre and alcohol-containing meals. A wide tolerance band catches hallucination without those false rejections — but the band width is a product call.

**Q3 — Should the activity estimate consume the health profile?** FR-005 does not require it, so this is a plausibility improvement rather than a spec fix. It would make the estimate falsifiable for the first time (weight × duration × MET gives an independent anchor), and the profile-fetch pattern already exists in `analysis.ts`. It is also scope growth beyond testing, and may belong in its own change.

**Q4 — Is fixing the CI branch trigger (`master` → `main`) in scope for this phase?** Phase 1 promises a CI gate. Today no workflow runs at all on this repo. Adding a test step without this fix ships a gate that never executes. I recommend including it; it is a one-line change and without it the phase's stated goal is not met.

**Q5 — Is the 422-on-config-fault misclassification in scope?** Archive F5, skipped twice. It has a clean oracle (a missing server secret is not client error) and a cheap test, but changing it is a behaviour fix, not a test addition — so it may belong to Lesson 5's bug→fix→regression workflow rather than here.

A note on sequencing regardless of the answers: the tests listed as having a sound oracle today can be written and will pass, giving Phase 1 a real floor. The Q1/Q2 tests will **fail against current code** — which is correct and expected, since risk #1 predicts exactly that gap. Whether Phase 1 ships those as red tests, or ships the guards alongside them, is the decision to make before `/10x-plan`.

---

# Second research pass — Risk #7: the N-day analysis window

**Date**: 2026-08-06T14:40:00+02:00
**Researcher**: lfrydrych
**Git Commit**: `548d7c5b4d694a908df526a1fb36c7c1656e1e1f`
**Branch**: `main`
**Repository**: frydrychlu/ketoai

Scope: **risk #7 only.** The runner (Vitest, `environment: "node"`, hand-written config that does not call `getViteConfig`) and the stubbing choice (MSW at the network edge) were settled by the 2026-08-04 pass above and are reused, not re-derived. Q3/Q4/Q5 from that pass remain out of scope per `change.md`.

## Research Question

From `context/foundation/test-plan.md` §2, risk #7:

> An unbounded or oversized N-day window turns one analysis request into unbounded prompt size, work, and spend on a free-tier runtime.

## Summary

**The risk splits cleanly into two halves with opposite verdicts. The half the risk map names is already closed. The half it does not name is open, and it is the one worth testing.**

**1. N is not unbounded — it is an enum, and that is stronger than a range.** `window_days` is validated as a union of three literals, not as `z.number().min().max()`:

```ts
window_days: z.union(ANALYSIS_WINDOWS.map((n) => z.literal(n)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]),
```

`src/pages/api/analysis/index.ts:26`, with `ANALYSIS_WINDOWS = [7, 14, 30]` at `src/types.ts:225`. Every value outside that set — `0`, `-1`, `365`, `1e9`, `"14"`, `null`, a missing key, an array — fails identically and returns **400 before any I/O of any kind**. This is not "validation is present"; it is a closed set of three values. The test-plan's challenge, *"Present is not bounded,"* is the right challenge and the code survives it.

This was a deliberate product decision, not an accident: `context/archive/2026-08-01-on-demand-ai-analysis/plan.md:36` lists **"No free-form or slider N — window is a fixed preset select (7/14/30)"** in the not-doing list, and the impl-review approved it. So the parameter half of risk #7 is **already closed**, and its test value is a *regression lock* on that decision, not a defect discovery.

**2. The rejection ordering is real, and stronger than the risk map asks for.** The route's sequence is 401 → 500-if-no-supabase → 400-on-bad-JSON → 400-on-Zod → DB reads → empty-gate → model call. A request rejected at the Zod boundary reaches **neither the model nor the database** — the `createClient` call above it constructs an object and performs no I/O (`src/lib/supabase.ts:9-23`). The risk map asks only that rejection precede the model call; it also precedes persistence-layer reads. Both are provable with one tripwire.

**3. The open half: N bounds the number of days, not the amount of data per day.** This is the third bullet of the risk response guidance — *"a value that is in range but selects an unbounded amount of data"* — and it is where the defect actually lives. `buildUserMessage` (`src/lib/services/analysis.ts:115-125`) serializes the whole gathered window, including the whole profile row. Of everything it serializes:

| Prompt component | Row bound | Per-row text bound | Verdict |
|---|---|---|---|
| `meals` (daily totals) | ≤ N points | numeric only, no descriptions | **bounded** |
| `activities` (daily totals) | ≤ N points | numeric only, no descriptions | **bounded** |
| `biomarkers` | ≤ N — `unique (user_id, day)` | numeric only | **bounded** |
| `wellness` | ≤ N — `unique (user_id, day)` | `notes` ≤ 2000 chars (Zod **and** DB CHECK) | bounded, but ≤ 60 000 chars at N=30 |
| `profile.health_goals` | 1 — `unique (user_id)` | **none at any layer** | **unbounded** |

`health_goals` is `z.string().min(1).nullable()` (`src/pages/api/profile/index.ts:17`) — no `.max()`. The column is bare `text` with no CHECK (`20260617072330_health_profiles.sql:30`), while its three numeric siblings in the same table all carry CHECKs. The `<textarea>` has no `maxLength` either (`ProfileForm.tsx:169-175`), unlike the wellness notes field which does (`WellnessLogger.tsx:296`). A user can save a megabyte of prose once and have it re-sent on **every** analysis request thereafter, at every window size. **N=7 and N=30 cost the same in this dimension** — which is exactly why capping N does not close the risk.

**4. Nothing bounds the output side either.** None of the three OpenRouter calls in this codebase sends `max_tokens` — verified across `analysis.ts:164-172`, `macros.ts:84`, `activity-estimate.ts:84`. The analysis `causes` array additionally has no `maxItems` in the structured-output schema (`analysis-schema.ts:43-55`). Output spend is bounded only by the model's own default. Since risk #7 is stated in terms of "prompt size, work, and **spend**," the output side belongs to it and is currently unexamined — the same shape of gap as risk #1's missing ceiling.

**5. A framing correction: the binding constraint is OpenRouter spend, not the Workers free tier.** The request makes 5 DB reads plus at most 2 OpenRouter calls, and the JS folding loops are trivial — nothing here approaches a Workers subrequest or CPU limit. `tech-stack.md` records "Cloudflare Pages free tier" with no numeric limits, so no source in this repo fixes those numbers. The risk is real but its cost lands at the model provider, and the plan should say so rather than testing against invented platform limits.

## Detailed Findings

### Where N enters, and what a rejected request costs

Entry is `POST /api/analysis` with `{ window_days, to }`. The island (`AnalysisView.tsx:46-49`) offers only the three presets, but the island is not the boundary — the HTTP API is, and it is reachable directly with any body.

The full boundary, `src/pages/api/analysis/index.ts:39-65`:

```ts
const user = context.locals.user;
if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

const supabase = createClient(context.request.headers, context.cookies);
if (!supabase) return Response.json({ error: "Supabase is not configured" }, { status: 500 });

let body: unknown;
try { body = await context.request.json(); }
catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }

const parsed = analysisRequestSchema.safeParse(body);
if (!parsed.success) {
  return Response.json({ error: "Validation failed", issues: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
}
const { window_days, to } = parsed.data;
const from = subtractDays(to, window_days - 1);
```

Consequences a test can assert:

- **Two distinct 400s.** Malformed JSON yields `{ error: "Invalid JSON body" }`; a well-formed body with a bad `window_days` yields `{ error: "Validation failed", issues: { window_days: [...] } }`. These are different failures and should not be collapsed into one test.
- **Extra body keys are stripped, not rejected.** `analysisRequestSchema` is a non-strict `z.object`, so `{ window_days: 14, to: "…", injected: "<10 MB>" }` is accepted — but only `parsed.data` is used downstream, and `buildUserMessage` reads from the gathered window, never from the body. **Prompt-size abuse via extra request keys is closed**, and that is worth one test because it is non-obvious from reading the schema alone.
- **`to` is validated for calendar reality but not for range** (`daySchema`, lines 15-21, with the round-trip refine). A far-future or far-past `to` is accepted; the window is still exactly N days, finds no data, and hits the empty-gate — so it costs 5 DB reads and **zero model calls**. The empty-gate at line 77 is a genuine cost control and should be tested as one.

### The ordering proof, and one trap in testing it

`requestAnalysis` is called at line 82; `gatherAnalysisWindow` at line 69; validation returns at line 62. The ordering is structural, not incidental.

Testing it cleanly is helped by a fact the first pass did not need: **`createClient` injects no custom `fetch`** (`src/lib/supabase.ts:9`), so `@supabase/ssr` falls through to global `fetch`. One MSW server therefore sees *both* the PostgREST calls and the OpenRouter call, distinguishable by URL. A single `onUnhandledRequest: "error"` plus a throwing tripwire on `https://openrouter.ai/*` proves "no model call was made" by naming itself in the failure, per the first pass's recommendation — and the absence of any `127.0.0.1:54321` request in the same run proves "no DB read either," for free. *(The no-custom-fetch reading is from the source, not from an executed test; confirm on first run.)*

**The trap:** the `!supabase` 500 sits *above* validation. If the `astro:env/server` stub leaves `SUPABASE_URL`/`SUPABASE_KEY` empty, every request returns 500 before Zod ever runs, and a test asserting merely "not 200" or "no model call" **passes for the wrong reason**. Assert the exact status `400`, and have the env stub supply non-empty Supabase values. This narrows the first pass's note that node-environment tests "need no secrets" — true for the meal path, false for this route.

### What is bounded by N and what is not

The two `unique (user_id, day)` constraints do real work here and are the reason the risk is half-closed:

- `biomarker_readings`: `unique (user_id, day)` at `20260630120001_biomarker_readings.sql:34` → at most N rows.
- `wellness_entries`: `unique (user_id, day)` at `20260630120002_wellness_entries.sql:40`, plus `check (char_length(notes) <= 2000)` at line 45 mirroring the Zod `.max(2000)` at `src/pages/api/wellness/index.ts:38` → at most N rows of at most 2 KB text.
- `meals` and `activities` have **no** unique constraint — both migrations say so explicitly (`20260630120000_activities.sql:17-18`: *"Unlike meals/biomarkers there is NO unique constraint: a user logs many activities per day"*). But both reach the prompt only as daily totals (`listDailyTotals`, `meals.ts:49-79`; `listDailyExpenditure`, `activities.ts:43+`), and neither `description` column is selected. **Unbounded row counts do not reach the prompt.**

They do, however, reach the *read*. Both services fetch every row in range and fold in JS, and `supabase/config.toml:18` sets `max_rows = 1000`. Past 1000 rows in the window PostgREST truncates **silently** — no error, no count — and the daily totals fed to both the trends dashboard and the analysis prompt become quietly wrong. This is a correctness defect surfaced by risk #7's abuse lens but owned by risks #1/#4; it is out of scope for this phase and belongs in the risk map. *(1000 is verified for the local stack from `config.toml`; the cloud project's `max_rows` was not verified in-session.)*

### Cost per request, and the retry multiplier

One accepted request costs: 5 parallel DB reads, then — if any data exists — 1 or 2 OpenRouter calls carrying the full window.

The retry loop (`analysis.ts:144-153`) inherits the shape the first pass documented in `macros.ts`:

```ts
const retryable = error instanceof OpenRouterError ? error.retryable : true;
if (!retryable || attempt === 1) break;
```

Only `OpenRouterError` carries a considered `retryable` flag (5xx true, 4xx false). **Everything else defaults to retryable** — including a Zod validation failure and a `JSON.parse` failure. So a model returning malformed output costs two full-prompt calls, not one. For risk #1 the first pass correctly warned that asserting the retry *count* mirrors the implementation. For risk #7 the count is the property under test: "a permanent failure costs exactly one call" is a cost-control assertion with a real oracle, and it is the one place where pinning the count is legitimate. Say so explicitly in the plan so the two rules do not look contradictory.

### The oracle — what fixes the bound

Per the oracle rules, taken from sources rather than from what the validation happens to allow:

- **FR-012 does not fix a maximum.** Verbatim: *"N is a configurable parameter the user sets before submitting the analysis request (default suggested: 14 days)."* It fixes only the *default*. Read literally it argues for a free numeric input, which is looser than what shipped.
- **The maximum is fixed by the shipped change's plan decision, not by the PRD**: `context/archive/2026-08-01-on-demand-ai-analysis/plan.md:36` and `:76`, reviewed and approved. That is a legitimate oracle for a regression test — it is a recorded product decision — but it is a weaker source than a PRD line, and it is the one that would move if FR-012 were ever implemented more literally.
- **No source fixes a maximum prompt size, a `max_tokens`, or a `health_goals` length.** `tech-stack.md` records no numeric free-tier limits. Stated plainly rather than invented; carried to Open Questions as Q6 and Q7.

**Mirror-test warning specific to this risk:** writing the accepted-values test as `ANALYSIS_WINDOWS.forEach(n => …)` imports the very constant the route validates against, so widening `ANALYSIS_WINDOWS` to `[7, 14, 30, 365]` would silently widen the test with it. **Hard-code `7, 14, 30` and the rejected values in the test file**, sourced from the plan decision and FR-012's default-14. The test's whole job is to fail when someone loosens that set.

### Testable properties with a sound oracle today

| # | Property | Oracle source | Layer |
|---|---|---|---|
| 7.1 | `window_days` ∈ {7, 14, 30} is accepted; **every** other value — `0`, `-1`, `6`, `31`, `365`, `1e9`, `3.5`, `"14"`, `null`, absent, `[]` — returns 400 | archive plan:36 preset decision; FR-012 default-14 | unit on the route (`it.each`) |
| 7.2 | A rejected request produces **zero outbound requests** — no OpenRouter call *and* no PostgREST call | risk #7 statement, sharpened: rejection precedes persistence too | unit + MSW tripwire |
| 7.3 | Malformed JSON returns 400 `"Invalid JSON body"`, distinct from the Zod 400 with `issues.window_days` | route contract, lines 50-63 | unit |
| 7.4 | An accepted request sends **exactly one** OpenRouter request whose body's serialized size is a function of window contents only, and whose `window_days` maps to `from = to − (N−1)` | `subtractDays`, line 65; inclusive-span contract | unit + MSW request capture |
| 7.5 | A fully-empty window returns `status: "empty"` at HTTP 200 with **no model call** | archive plan:132 empty-gate; route line 77 | unit + tripwire |
| 7.6 | A non-retryable OpenRouter failure (4xx) costs **exactly one** call; a 5xx costs at most two | `OpenRouterError.retryable`, lines 87-93 — cost control, the licensed exception to the count-mirroring rule | unit |
| 7.7 | Extra keys in the request body never reach the outbound prompt | non-strict `z.object` + `buildUserMessage` reads the window, not the body | unit + MSW request capture |

Properties **7.8 (a bound on `health_goals`)** and **7.9 (a `max_tokens` ceiling)** have no oracle until Q6/Q7 are answered. Per the `change.md` decision that guards ship alongside tests, these are guard-plus-test work for `/10x-plan`, not red tests.

### Anti-patterns specific to this risk

| Anti-pattern | Why it fails here |
|---|---|
| Asserting the happy path N=14 only | Named by the risk map. All seven properties above live at the edges. |
| Deriving accepted values from `ANALYSIS_WINDOWS` | Mirror test — widening the constant widens the test. Hard-code the three values. |
| Asserting "not 200" instead of exactly 400 | The `!supabase` 500 above validation makes this pass for the wrong reason. |
| Counting MSW lifecycle events to prove "no model call" | The first pass's finding: a throwing tripwire names the failure; a count assertion reports `0 !== 1`. |
| One parameterised test per rejected value in six near-identical blocks | Vibe-testing "redundant copies". One `it.each` over the rejected values; one separate test per *distinct* rejection path (JSON vs Zod). |

## Code References

- [`src/pages/api/analysis/index.ts:23-28`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/pages/api/analysis/index.ts#L23-L28) — the entire bound on N: a union of three literals, not a range
- [`src/pages/api/analysis/index.ts:57-65`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/pages/api/analysis/index.ts#L57-L65) — the 400 branch and `from` derivation; everything costly is below this line
- [`src/pages/api/analysis/index.ts:44-48`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/pages/api/analysis/index.ts#L44-L48) — the `!supabase` 500 that sits *above* validation; the env-stub trap
- [`src/pages/api/analysis/index.ts:77-79`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/pages/api/analysis/index.ts#L77-L79) — the empty-window gate; a real cost control, testable
- [`src/types.ts:225`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/types.ts#L225) — `ANALYSIS_WINDOWS = [7, 14, 30]`; the constant a test must *not* import
- [`src/lib/services/analysis.ts:115-125`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/services/analysis.ts#L115-L125) — `buildUserMessage`; serializes the whole window including the whole profile row
- [`src/lib/services/analysis.ts:157-173`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/services/analysis.ts#L157-L173) — the outbound request; **no `max_tokens`**
- [`src/lib/services/analysis.ts:144-153`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/services/analysis.ts#L144-L153) — retry loop; non-`OpenRouterError` defaults to retryable, so a Zod failure costs two calls
- [`src/pages/api/profile/index.ts:17`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/pages/api/profile/index.ts#L17) — `health_goals: z.string().min(1).nullable()` — the unbounded prompt input
- [`supabase/migrations/20260617072330_health_profiles.sql:30`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/supabase/migrations/20260617072330_health_profiles.sql#L30) — bare `text`, no CHECK, beside three sibling columns that all have one
- [`supabase/migrations/20260630120002_wellness_entries.sql:40-45`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/supabase/migrations/20260630120002_wellness_entries.sql#L40-L45) — `unique (user_id, day)` + 2000-char notes CHECK; the pattern `health_goals` should have followed
- [`src/lib/supabase.ts:9-23`](https://github.com/frydrychlu/ketoai/blob/548d7c5b4d694a908df526a1fb36c7c1656e1e1f/src/lib/supabase.ts#L9-L23) — no custom `fetch` injected, so MSW sees PostgREST traffic too
- `supabase/config.toml:18` — `max_rows = 1000`; silent truncation ceiling on the meal/activity range reads

## Architecture Insights

- **The enum is the strongest bound in the codebase, and it happened by scope discipline rather than by a security decision.** The archive plan cut free-form N to keep the change small; the side effect was to close the abuse surface completely. Risk #7's parameter half is a case of a "not doing" line accidentally being the mitigation — worth recording, because the protection disappears the moment someone implements FR-012 more literally, and nothing in the code says why the enum matters.
- **The same asymmetry the first pass found in risk #1 repeats here, one layer out.** There, user-typed numerics were bounded and AI-derived numerics were not. Here, every field that feeds the prompt is bounded *except* the one free-text field on the singleton table — and `wellness.notes`, the other free-text field reaching the prompt, *is* bounded at 2000 in both Zod and the DB. The convention exists; `health_goals` is the one place it was not applied.
- **The prompt payload includes whole rows.** `select("*")` on biomarkers and wellness means `id`, `user_id`, `created_at`, and `updated_at` are serialized into every analysis prompt. Harmless for size, but it sends the user's own UUID to OpenRouter for no purpose. Not a risk-#7 defect; noted because it is a one-line narrowing if the prompt is ever touched.

## Historical Context (from prior changes)

- `context/archive/2026-08-01-on-demand-ai-analysis/plan.md:36` — *"No free-form or slider N — window is a fixed preset select (7/14/30)."* The decision that closes half of risk #7.
- `.../plan.md:132, :219, :279-281` — the route contract and its verification steps already record "Zod rejects `window_days` outside {7,14,30}" and "Invalid `window_days` (e.g. 10) returns 400", both checked off manually. Phase 1 converts a manual check into an automated one; that is a real gain, not a duplicate.
- `.../reviews/impl-review.md:46-61` (**F1**, OBSERVATION, SKIPPED) — the origin of risk #7. Its stated concern is *"repeated clicks translate directly to OpenRouter spend"* — that is request **frequency**, which `test-plan.md` §7 correctly excludes as untestable with no rate limiter. F1's parenthetical *"up to 30 days of data"* is the part that maps to risk #7, and it is bounded. **F1 is therefore a weaker source for this risk than the risk map implies** — the map's own reading of it ("N is a user-set parameter", from FR-012) is the better one.

## Open Questions

Continuing the numbering from the first pass. Neither blocks the seven testable properties above.

**Q6 — Should `health_goals` carry a length cap, and at what value?** No source fixes one. This is the only unbounded input reaching the analysis prompt, and the repo's own convention answers the *shape* of the fix even if not the number: `wellness.notes` is capped at 2000 in Zod **and** in a DB CHECK **and** in the textarea. My recommendation: apply that same triple to `health_goals`. The number is a product call, but 2000 is the value this codebase already chose for the analogous field, so adopting it is following precedent rather than inventing a bound. Note this is a guard on the *profile* route, so it widens Phase 1's blast radius beyond the analysis endpoint — worth confirming before planning.

**Q7 — Should the OpenRouter calls send `max_tokens`?** No source fixes a value, and none of the three calls sends one today. Risk #7 names spend explicitly, so the output side is in scope on its face; but a ceiling set too low truncates a legitimate analysis mid-JSON, which the Zod parse would then reject and the retry loop would then repeat — turning a cost control into a cost *doubler*. If adopted it must be generous and paired with 7.6's single-call assertion. I lean toward recording it as a known gap and not fixing it in Phase 1.

**Q8 — Does the `max_rows = 1000` silent truncation belong in the risk map?** It is a correctness defect (wrong daily totals, wrong prompt data) reachable at ~33 meals/day over a 30-day window, and it is invisible — no error is raised. It is not risk #7 and not this phase's work, but it is currently in no risk's scope. Recommend recording it against risk #4 (daily totals wrong at a boundary) at the next `/10x-test-plan --refresh` rather than acting on it here.

## What Turned Out Closed or Speculative

Stated explicitly, as the pass was asked to do:

- **CLOSED — "unbounded N".** N is a three-value enum; there is no range to escape. The risk map's headline phrasing does not match the code.
- **CLOSED — "a rejected request still costs a model call."** Rejection precedes both the model call and every DB read.
- **CLOSED — prompt-size abuse via the request body.** Extra keys are stripped and never reach the prompt; meal and activity descriptions are not selected into it.
- **SPECULATIVE — the free-tier runtime framing.** 5 DB reads + ≤2 model calls per request is nowhere near a Workers limit, and no source in this repo records what those limits are. The cost is at OpenRouter.
- **WEAKER THAN CITED — impl-review F1.** F1 is about request frequency, which §7 excludes. Only its "up to 30 days of data" aside touches risk #7, and that is bounded.
- **OPEN, and the real finding — `health_goals` is unbounded at every layer** (textarea, Zod, DB) and is re-sent on every analysis request at every window size. This is the "in range but selects unbounded data" face the risk guidance predicted, and it is the only one that survived grounding.
- **OPEN — no `max_tokens` on any of the three LLM calls**, and no `maxItems` on the `causes` array.

**Net for planning:** risk #7 yields seven tests with a sound oracle today, all of which will pass against current code — they lock in a bound that already exists and is currently protected only by a "not doing" line in an archived plan. Combined with risk #1, where the tests fail until the guards ship, Phase 1 has both a green regression floor and a real defect to close.
