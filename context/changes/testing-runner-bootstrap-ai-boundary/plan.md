# Test-Runner Bootstrap and AI Boundary — Implementation Plan

## Overview

Rollout Phase 1 of `context/foundation/test-plan.md` §3. This change brings the first test runner into a repo with zero test files, then uses it to lock two properties: that a wrong-but-well-formed model value cannot silently persist (risk #1), and that a hostile analysis request is rejected before it costs anything (risk #7).

The two risks arrive in opposite states, and the plan is shaped around that asymmetry. Risk #7's request boundary is **already correct** — its tests are a regression lock that passes on day one. Risk #1's ceiling **does not exist** — its tests fail until the guard ships alongside them. Per the `change.md` decision, guards ship with the tests so Phase 1 ends green rather than leaving a red suite that cannot become a CI gate.

## Current State Analysis

**No test infrastructure exists.** Zero test files, no runner, no runner config, no stubbing library. `package.json` has no `test` script. This change creates that layer from nothing, which is why the harness gets its own phase and its own smoke test.

**Risk #1 — the ceiling is missing, and only there.** Every user-typed physiological value in the codebase is bounded at both ends; every AI-derived numeric is bounded only below:

| Field | Provenance | Constraint today |
|---|---|---|
| `ketones_mmol_l`, `glucose_mg_dl`, `weight_kg`, `water_liters`, ratings | user-typed | bounded both ends, Zod **and** DB CHECK |
| `meals.fat_g / protein_g / carbs_g / calories_kcal` | model-generated | `.min(0)` only |
| `activities.calories_kcal` | model-generated | `.min(0)` only |

The floor was retrofitted on 2026-06-20 (`20260620075537_meals_macro_nonneg.sql`); the ceiling was never raised in any plan or review. A model returning `calories_kcal: 999999` clears Zod, clears the CHECK, and is written verbatim — then flows through `sumDailyTotal` into the daily total, the trends chart, and the FR-012 analysis prompt (`analysis.ts:43`). Nothing revalidates on read at any hop.

**Risk #7 — the parameter is closed; the payload is not.** `window_days` is a three-literal union of `ANALYSIS_WINDOWS = [7, 14, 30]` (`src/pages/api/analysis/index.ts:26`), not a range. Everything outside that set returns 400 **before any DB read and before any model call**. That bound exists because the archived plan cut free-form N as scope discipline (`archive/2026-08-01-on-demand-ai-analysis/plan.md:36`) — nothing in the code says it matters, which is exactly what makes it worth a regression test.

What N does **not** bound is per-request payload. `buildUserMessage` serializes the whole gathered window including the whole profile row, and `health_goals` is capped nowhere — not in the textarea, not in Zod (`profile/index.ts:17`), not in the DB (bare `text`, no CHECK). It is a singleton re-sent in full on every analysis request, so **N=7 and N=30 cost the same in that dimension**. Its sibling free-text field, `wellness.notes`, has the full triple: `.max(2000)`, a `char_length` CHECK, and `maxLength` on the textarea.

## Desired End State

`npm test` exists and runs a Vitest suite that passes. The suite proves, without a live model call and without Docker:

- An implausible-but-well-formed macro response — over the ceiling, or internally inconsistent by the Atwater law — is refused, surfaces as 422, and **writes no row**.
- A hostile or out-of-range `window_days` returns exactly 400 and produces **zero outbound requests of any kind** — no OpenRouter call and no PostgREST call.
- The three unbounded free-text and numeric inputs that reach a model prompt now carry bounds at the validation layer, backed by DB CHECKs.

Verify by running `npm test`, `npm run lint`, and `npx astro check` — all three pass with the new `tests/` tree present.

### Key Discoveries

- **Test files cannot live under `src/pages/`.** Astro routes every `.ts` file there, so `src/pages/api/analysis/index.test.ts` would become a live endpoint. The suite lives in a top-level `tests/` tree.
- **`getViteConfig()` must not be called.** It runs `runHookConfigSetup`, activating the Cloudflare adapter and `@cloudflare/vite-plugin`, which is hostile to Vitest 4 (withastro/astro#15878, fixed 2026-07-02 in versions this repo does not have — astro 6.3.1, adapter 13.5.0). A hand-written `vitest.config.ts` sidesteps it. Cost: no `.astro` compilation and no `astro:*` virtual modules, of which only `astro:env/server` is used, by five files. One alias replaces it.
- **MSW sees Supabase traffic too.** `createClient` injects no custom `fetch` (`src/lib/supabase.ts:9-23`), so `@supabase/ssr` falls through to global `fetch`. One MSW server covers both the PostgREST calls and the OpenRouter call, distinguishable by URL — which is what makes "wrote no row" assertable as "no POST to `/rest/v1/meals`".
- **The `!supabase` 500 sits above validation** (`analysis/index.ts:46-48`). If the env stub leaves Supabase values empty, every request 500s before Zod runs and a loose assertion passes for the wrong reason.
- **The env stub can use ESM live bindings.** All three vars are `optional: true` (`astro.config.mjs:19-21`) and every service reads them *inside* the function body, so an `export let` + setter lets a test flip a value without `vi.resetModules()`.
- **ESLint runs `strictTypeChecked` + `stylisticTypeChecked` with `projectService: true`** over `**/*.ts`, and `tsconfig.json` includes `**/*`. Test files are both linted and typechecked.
- **`20260620075537_meals_macro_nonneg.sql` is the migration template** — forward-only, named constraints, a header comment stating the defense-in-depth rationale.

## What We're NOT Doing

- **No `max_tokens` on any OpenRouter call.** A ceiling low enough to constrain spend truncates the analysis mid-JSON; Zod then rejects it and the retry loop repeats the whole prompt — a cost control that doubles cost. Recorded as an open gap.
- **No CI workflow edit.** `.github/workflows/ci.yml` triggers on `master` while this repo is `main`, so no workflow runs today. Adding a test step would advertise a gate that does not execute. §3 Phase 5 owns gate wiring and the branch-trigger fix together.
- **No DB integration test and no SQL recipe for the new CHECKs.** The automated suite stays hermetic and Docker-free. See Open Risks.
- **No profile input to the activity estimate** (research Q3 — scope growth beyond testing).
- **No 422-on-config-fault fix** (research Q5 — that is Lesson 5's bug→fix→regression workflow).
- **No fix for the `max_rows = 1000` silent truncation** on the meal/activity range reads (research Q8 — a correctness defect belonging to risk #4, to be recorded at the next `--refresh`).
- **No e2e, no component rendering, no `.astro` compilation.** Node environment only.
- **No shared LLM-boundary helper.** `macros.ts` and `activity-estimate.ts` stay copy-paste twins. Hoisting a shared boundary would move the stub seam mid-phase; the refactor is a separate change.

## Implementation Approach

Five phases, ordered so each one is verifiable before the next begins.

The harness comes first and proves itself on a smoke test. **Risk #7's tests come second, deliberately, before any production code changes** — they run against unchanged code and must pass, so a failure there means the harness is wrong, not the guard. Only then do the guards land: risk #1's ceilings and Atwater band (Phase 3), then risk #7's `health_goals` bound (Phase 4). Phases 3 and 4 stay separate despite both being "add a bound" because they answer different risks on different routes, and merging them would blur which change protects what.

Guards live in the existing schema modules, not in a new shared layer, so the stub seam the tests target does not move.

Phases 3 and 4 are strong `/10x-tdd` candidates — each has a nameable first red test. Phases 1, 2, and 5 are `/10x-implement` work (harness setup, tests on unchanged code, documentation).

## Critical Implementation Details

**A guard rejection costs two model calls, and that is deliberate.** The retry loop treats any non-`OpenRouterError` as retryable (`macros.ts:64-73`), so a Zod failure — including the new ceiling and Atwater rejections — triggers one retry before surfacing 422. This is existing behaviour for schema failures and is kept: at `temperature: 0` a retry still gives a second chance at a plausible parse, and changing it would be a behaviour change beyond this phase. Because it is a cost property where risks #1 and #7 meet, it is asserted explicitly rather than left implicit — the test pins *exactly two* outbound calls followed by 422.

**Ceiling and Atwater rejections must be distinguishable in tests but not to the user.** Both surface through `MacroParseError` → 422 with the same Polish message. Tests assert the boundary outcome (422, no row written), not the message text.

**The `tests/**` ESLint override is required, not cosmetic.** Under `strictTypeChecked`, the `APIContext` cast and MSW's `request.json()` return `any`, tripping `no-unsafe-assignment` / `no-unsafe-member-access` / `no-unsafe-call`. Without a scoped override, `npm run lint` fails on the first test file and the implementer will fight the linter instead of writing tests.

## Phase 1: Runner bootstrap

### Overview

Create the test layer from nothing: runner, config, env stub, network stubbing, a route-handler harness, and the lint exemption — then prove the whole thing works with one smoke test.

### Changes Required:

#### 1. Dependencies and script

**File**: `package.json`

**Intent**: Add the runner and the network-stubbing library as devDependencies, and the `test` script that every later phase and (eventually) §3 Phase 5's CI gate will call.

**Contract**: `vitest` ^4.1.10 and `msw` ^2.15.0 in `devDependencies`. Scripts gain `"test": "vitest run"` and `"test:watch": "vitest"`. No change to `.github/workflows/ci.yml`.

#### 2. Runner configuration

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Configure Vitest without touching Astro's config pipeline, and alias the one `astro:*` virtual module the code under test imports.

**Contract**: Hand-written `defineConfig` from `vitest/config`. **Must not import or call `getViteConfig` from `astro/config`** — see Key Discoveries. Sets `test.environment: "node"`, `test.include: ["tests/**/*.test.ts"]`, `test.setupFiles: ["./tests/setup.ts"]`, and `test.globals: false`. Two `resolve.alias` entries: `@` → `./src` (mirroring `tsconfig.json` paths) and `astro:env/server` → `./tests/stubs/astro-env.ts`.

#### 3. Environment stub

**File**: `tests/stubs/astro-env.ts` (new)

**Intent**: Stand in for `astro:env/server` so services can read secrets under test, and let a test flip a value mid-run to exercise the "key not configured" branch.

**Contract**: Exports `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY` as mutable `let` bindings (matching the `string | undefined` type from `astro.config.mjs`), plus setter and reset functions. Defaults must be non-empty — `SUPABASE_URL` a stable fake origin the MSW handlers match on, and `SUPABASE_KEY` / `OPENROUTER_API_KEY` any non-empty string. The mutable-binding shape is load-bearing: services read these inside function bodies, so ESM live bindings propagate a setter call without `vi.resetModules()`.

#### 4. Network stubbing and tripwire

**Files**: `tests/setup.ts`, `tests/helpers/msw.ts` (both new)

**Intent**: Route every outbound `fetch` through MSW, fail any request no test expected, and give the suite a way to prove a call was never made that names itself when it fires.

**Contract**: `setup.ts` starts an MSW `setupServer` with `onUnhandledRequest: "error"`, resets handlers between tests, and closes after the run. `msw/node`'s `setupServer` is the Node entry point. `helpers/msw.ts` exports named handler factories for the OpenRouter completions endpoint (success with a given payload, HTTP status failure, malformed body) and for the PostgREST table endpoints, plus **tripwire handlers that throw** for both hosts. Per research, a throwing tripwire beats counting lifecycle events — the failure message names the call that should not have happened rather than reporting `0 !== 1`.

#### 5. Route-handler harness

**File**: `tests/helpers/api-context.ts` (new)

**Intent**: Let a test invoke an exported `POST`/`GET` directly, since Astro ships no official route-testing helper and the Container API's endpoint support is experimental.

**Contract**: A builder returning a minimal `APIContext`. The routes under test touch only `context.locals.user`, `context.request`, and `context.cookies`; `env.d.ts` types `locals.user` as `User | null` and routes read only truthiness and `user.id`, so a `{ id }` stub plus a cast suffices. The builder takes a JSON body and an optional user, and must support a body that is invalid JSON so the route's `catch` branch is reachable.

#### 6. Lint exemption for tests

**File**: `eslint.config.js`

**Intent**: Keep `npm run lint` passing once test files exist, without weakening the rules that protect `src/`.

**Contract**: A new config object scoped to `files: ["tests/**/*.ts"]`, appended after `baseConfig`, turning off `@typescript-eslint/no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, and `no-unsafe-argument`. Scope it to `tests/**` only — `src/` keeps the strict preset.

#### 7. Smoke test

**File**: `tests/smoke.test.ts` (new)

**Intent**: Prove the harness end to end before any real test depends on it — module resolution through the `@` alias, the `astro:env/server` stub, MSW interception, and the tripwire actually throwing.

**Contract**: Explicit `import { describe, it, expect } from "vitest"` (no globals). Asserts that a value imported through the `@` alias resolves, that the env stub returns its default and reflects a setter call, and that a `fetch` to the OpenRouter endpoint with the tripwire installed rejects.

### Success Criteria:

#### Automated Verification:

- Suite runs and passes: `npm test`
- Linting passes with the new `tests/` tree present: `npm run lint`
- Type checking passes with the new `tests/` tree present: `npx astro check`
- Build is unaffected: `npm run build`

#### Manual Verification:

- `vitest.config.ts` contains no reference to `getViteConfig`, and the run produces no Cloudflare-adapter or `@cloudflare/vite-plugin` output
- Watch mode starts and re-runs on edit: `npm run test:watch`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Risk #7 — request-boundary lock

### Overview

Write the seven properties research identified for the analysis endpoint. **No production code changes in this phase.** Every test must pass on first correct write; a failure indicates a harness defect, not a product defect.

### Changes Required:

#### 1. Analysis request-boundary tests

**File**: `tests/api/analysis.test.ts` (new)

**Intent**: Lock the bound on `window_days` that currently exists only as an undocumented consequence of an archived scope decision, and prove that rejection precedes every cost — the model call and the database reads alike.

**Contract**: Covers the seven properties, keyed to research §"Testable properties":

- **7.1** — `7`, `14`, `30` accepted; `0`, `-1`, `6`, `31`, `365`, `1e9`, `3.5`, `"14"`, `null`, absent, and `[]` each return **exactly 400**. One `it.each` over the rejected values. **Hard-code `7, 14, 30` — do not import `ANALYSIS_WINDOWS`.** Importing the constant the route validates against is a mirror test: widening the constant would silently widen the test, and failing on exactly that widening is the test's entire purpose. Add a comment saying so, or a future reader will "fix" it into a mirror.
- **7.2** — a rejected request produces zero outbound requests: OpenRouter tripwire *and* PostgREST tripwire both installed, neither fires.
- **7.3** — malformed JSON returns 400 `"Invalid JSON body"`, distinct from the Zod 400 carrying `issues.window_days`.
- **7.4** — an accepted request sends exactly one OpenRouter request, and the window it carries reflects `from = to − (N−1)`. Assert against the captured request body.
- **7.5** — a fully-empty window returns `status: "empty"` at HTTP 200 with no model call (PostgREST handlers return `[]` for all five reads; OpenRouter tripwire installed).
- **7.6** — a non-retryable OpenRouter 4xx costs exactly one call; a 5xx costs at most two. This is the licensed exception to the count-mirroring rule: the count is the cost-control property under test, not an implementation detail. Comment it as such, since research warns against count assertions elsewhere.
- **7.7** — extra keys in the request body never reach the outbound prompt (non-strict `z.object` strips them, and `buildUserMessage` reads the window rather than the body).

Assert **exactly 400**, never "not 200" — the `!supabase` 500 above validation would satisfy a loose assertion for the wrong reason. The env stub must supply non-empty Supabase values throughout.

### Success Criteria:

#### Automated Verification:

- All risk-#7 tests pass against unchanged production code: `npm test`
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`

#### Manual Verification:

- `git diff` for this phase touches only `tests/` — no file under `src/` or `supabase/` changed
- Temporarily widening `ANALYSIS_WINDOWS` to include a fourth value makes test 7.1 fail (confirms it is a real lock, not a mirror); revert afterwards

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Risk #1 — plausibility guards and tests

### Overview

Close the missing ceiling on every AI-derived numeric, add the cross-field consistency check that gives risk #1 its only non-mirroring oracle, and prove both with tests that fail before the guard and pass after.

**TDD-able.** First red test: *"a macro response whose calories fall below 75% of the Atwater-derived value is rejected and no meal row is written."*

### Changes Required:

#### 1. Macro schema — ceiling and consistency band

**File**: `src/lib/services/macro-schema.ts`

**Intent**: Refuse model output that is well-formed but physiologically absurd or internally inconsistent, so it never reaches the insert. This is the guard whose absence risk #1 names.

**Contract**: `macroResultSchema` gains per-field ceilings — `fat_g`, `protein_g`, `carbs_g` each `.max(1000)`; `calories_kcal` `.max(10000)` — and a schema-level `.refine` enforcing the asymmetric Atwater band.

The band, and why it is asymmetric — this is the one place a snippet earns its keep, because the direction of the tolerance is the whole design:

```ts
// Atwater: 9 kcal/g fat, 4 kcal/g protein and carbs. Reject only when reported
// calories fall well BELOW the macro-derived value — that is the hallucination
// shape (one inconsistent field among four, e.g. carbs: 200 with calories: 150).
// Tolerate reported ABOVE computed without limit: alcohol is ~7 kcal/g and is
// represented by none of the four fields, so a drink legitimately reads high.
// Fibre pushes computed ~7-10% above reported (fibre yields ~2 kcal/g, not 4),
// which sits well inside the 25% slack.
// 0.75 and the 50 kcal floor are judgment calls, not sourced values — no PRD
// line fixes them. The floor keeps rounding noise on tiny entries from tripping
// the rule.
const derived = 9 * fat_g + 4 * protein_g + 4 * carbs_g;
return derived < 50 || calories_kcal >= derived * 0.75;
```

Leave `macroJsonSchema` unchanged: the structured-output schema tells the model what shape to emit; the guard is what we refuse to trust. Adding `minimum`/`maximum` there would ask the model to self-police the property under test.

#### 2. Activity estimate schema — ceiling

**File**: `src/lib/services/activity-estimate-schema.ts`

**Intent**: Apply the same ceiling to the activity path. It has one number and no correlate, so no consistency check is possible — the ceiling is the only guard available.

**Contract**: `activityEstimateResultSchema.calories_kcal` gains `.max(10000)`. No Atwater analogue; note in the comment that the single-field shape is why.

#### 3. Database ceilings

**File**: `supabase/migrations/20260806120000_ai_numeric_ceilings.sql` (new)

**Intent**: Hold the ceiling regardless of the writer, completing the pattern the floor established and closing the path where Zod never runs — the live but unused `meals_update_own` / `activities_update_own` RLS policies.

**Contract**: Forward-only `alter table ... add constraint`, mirroring `20260620075537_meals_macro_nonneg.sql` exactly: named constraints, header comment stating the defense-in-depth rationale and citing this phase. Four constraints on `public.meals` (`meals_fat_g_max`, `meals_protein_g_max`, `meals_carbs_g_max` at 1000; `meals_calories_kcal_max` at 10000) and one on `public.activities` (`activities_calories_kcal_max` at 10000). Values must match the Zod ceilings. **No Atwater constraint in SQL** — a cross-field CHECK would need the same tolerance reasoning duplicated in a second language, and the validation layer is where that rule belongs.

#### 4. Macro boundary tests

**File**: `tests/services/macros.test.ts` (new)

**Intent**: Prove the guard rejects what it must, accepts what it must not reject, and that a rejection persists nothing.

**Contract**: Against stubbed OpenRouter responses:

- Over-ceiling values (each of the four fields, individually) → `MacroParseError`, no PostgREST write.
- Atwater-inconsistent response (`carbs_g: 200` with `calories_kcal: 150`) → rejected.
- **Accepted-not-rejected cases, which are the false-positive guard**: a high-fibre-shaped meal where computed exceeds reported by ~10%, and an alcohol-shaped entry where reported far exceeds computed. Both must pass. Without these the band is untested in the direction that would hurt real users.
- A response at exactly the ceiling is accepted; one above is not.
- Existing floor behaviour (negative, missing key, string, `null`) still rejects — regression cover for the guard change.

Expected values come from the PRD and the Atwater law, never from running the parser. Do not assert specific macro numbers for a described meal: FR-005's Socrates note accepts ±30–50% inaccuracy, so any such assertion only proves the stub the test wrote came back.

#### 5. Route-level rejection tests

**File**: `tests/api/meals.test.ts` (new)

**Intent**: Prove the rejection reaches the user as the documented failure and leaves the database untouched — the property risk #1 is actually about.

**Contract**: `POST /api/meals` with a guard-violating stubbed model response returns **422**, and the PostgREST tripwire never fires. Plus the cost property from Critical Implementation Details: a guard rejection produces **exactly two** OpenRouter requests (initial + one retry) before the 422, since the retry loop treats non-`OpenRouterError` failures as retryable.

#### 6. Activity boundary tests

**File**: `tests/services/activity-estimate.test.ts` (new)

**Intent**: Same ceiling coverage for the twin service.

**Contract**: Over-ceiling → rejected, no write; at-ceiling → accepted; existing floor behaviour intact.

### Success Criteria:

#### Automated Verification:

- All tests pass: `npm test`
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- Migration applies cleanly against a fresh local stack: `npx supabase db reset` (requires Docker)
- Reverting either schema guard makes the corresponding test fail — confirms the tests bind to the guard, not to incidental behaviour
- Optional, per the lesson's selective-gate guidance: `npx stryker run --mutate "src/lib/services/macro-schema.ts"`, then judge each survived mutant by "would this hurt a user or the business?" Not wired into the repo and not a gate; do not chase a score

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: `health_goals` bound

### Overview

Close risk #7's one live defect: the only unbounded input that reaches a model prompt. Applies the exact triple `wellness.notes` already uses, so the value needs no independent justification.

**TDD-able.** First red test: *"a profile submission whose health_goals exceeds 2000 characters is rejected and the profile is not written."*

### Changes Required:

#### 1. Validation cap

**File**: `src/pages/api/profile/index.ts`

**Intent**: Bound the field at the API boundary, matching the sibling free-text field.

**Contract**: `health_goals` becomes `z.string().min(1).max(2000).nullable()`. The existing rejection path (redirect to `/profile?error=...` with the `FIELD_LABELS` prefix) already handles it — no new branch.

#### 2. Database cap

**File**: `supabase/migrations/20260806120001_health_goals_length.sql` (new)

**Intent**: Match `wellness_entries_notes_check`, so the bound holds for any writer.

**Contract**: Forward-only `alter table public.health_profiles add constraint health_profiles_health_goals_check check (char_length(health_goals) <= 2000)`. Header comment cites the analysis-prompt rationale — this field is re-sent in full on every FR-012 request — and names `20260630120002_wellness_entries.sql:45` as the pattern being followed.

#### 3. Form cap

**File**: `src/components/profile/ProfileForm.tsx`

**Intent**: Stop the input at the source, as the wellness form already does.

**Contract**: A module-level `GOALS_MAX = 2000` constant and `maxLength={GOALS_MAX}` on the `health_goals` textarea, mirroring `NOTES_MAX` at `WellnessLogger.tsx:25,296`.

#### 4. Profile boundary test

**File**: `tests/api/profile.test.ts` (new)

**Intent**: Prove the cap rejects and that the over-long value never reaches the database.

**Contract**: The profile route takes `FormData`, not JSON — the `APIContext` helper needs a form-body variant. A submission with a 2001-character `health_goals` redirects with the error parameter and the PostgREST tripwire never fires; a 2000-character value is accepted.

### Success Criteria:

#### Automated Verification:

- All tests pass: `npm test`
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- Migration applies cleanly: `npx supabase db reset`
- The profile form stops accepting input at 2000 characters in the browser
- An over-long value submitted with the client cap bypassed surfaces the "Health goals: ..." error banner rather than saving

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 5: Cookbook and plan sync

### Overview

Turn what this phase learned into the reusable patterns §6 promises, and bring the rollout state files in line with what shipped.

### Changes Required:

#### 1. Cookbook patterns

**File**: `context/foundation/test-plan.md` §6

**Intent**: Replace the "TBD — see §3 Phase 1" placeholders with the patterns an implementer can copy.

**Contract**: §6.1 (unit test) — the runner, the explicit-import convention, the env stub and its live-binding trick, and the rule that model output is asserted by rejection rather than by value. §6.2 (integration test) — the MSW network-edge pattern, `onUnhandledRequest: "error"`, and the throwing tripwire for "this call must not happen". §6.4 (new API endpoint) — the `APIContext` harness, the request-boundary rejection pattern, assert-exact-status, and the hard-code-don't-import rule for enum bounds. §6.6 — per-phase notes including the two-calls-per-guard-rejection cost property and the Astro-routes-every-file-in-src/pages constraint.

#### 2. Stack and status sync

**Files**: `context/foundation/test-plan.md` §3/§4/§5, `context/changes/testing-runner-bootstrap-ai-boundary/change.md`

**Intent**: Record what is now true, including what deliberately did not ship.

**Contract**: §4 rows for "unit + integration" and "model-response stubbing" name Vitest and MSW with versions and a `checked:` date. §3 Phase 1 status → `complete`. §5 keeps the existing note that the unit+integration gate does not execute until the branch trigger is fixed in Phase 5 — do not mark it live. `change.md` → `status: complete`, with the accepted risks recorded.

#### 3. Risk-map corrections

**File**: `context/foundation/test-plan.md` §2

**Intent**: Carry forward the two findings this change produced that outlive it.

**Contract**: Risk #1's Source note gains that the ceiling shipped 2026-08-06 with an asymmetric Atwater band, and that the band's constants are judgment calls. Add the `max_rows = 1000` silent-truncation finding to risk #4's Source as a pointer for the next `--refresh` (research Q8) — recorded, not acted on.

### Success Criteria:

#### Automated Verification:

- Full suite still passes: `npm test`
- Linting passes: `npm run lint`

#### Manual Verification:

- §6.1, §6.2, and §6.4 contain concrete patterns with file references, not restated principles
- No §6 sub-section touched by this phase still reads "TBD"
- A reader who was not part of this change could add a test for a new endpoint from §6.4 alone

---

## Testing Strategy

### Unit Tests

- Schema guards in isolation: ceiling at, above, and below the bound for all five AI-derived numerics.
- The Atwater band in both directions, including the two false-positive cases (high-fibre shape, alcohol shape) that the asymmetry exists to protect.
- Existing floor and shape rejections, as regression cover for the guard change.

### Integration Tests

"Integration" here means route-level tests with the network stubbed at the edge — the HTTP boundary exercised end to end, with no real infrastructure:

- `POST /api/meals` — guard rejection surfaces as 422 and writes nothing; exactly two model calls on a guard rejection.
- `POST /api/analysis` — the seven request-boundary properties, including zero outbound requests on rejection and the empty-window short-circuit.
- `POST /api/profile` — the `health_goals` cap rejects and writes nothing.

### Manual Testing Steps

1. `npx supabase db reset` — both migrations apply cleanly against a fresh stack.
2. Log a meal in the running app; confirm normal meals still parse and save (the guards must not break the happy path).
3. Paste over 2000 characters into the profile Health goals field; confirm the input stops at the cap.
4. Run the analysis at each of the three window sizes against a seeded account; confirm all three still work.

## Performance Considerations

None material. The guards are arithmetic on four numbers at an existing validation boundary. The two new CHECK constraints are evaluated per row on insert and update, on tables with a per-user index already in place.

Worth noting for the record rather than for action: a guard rejection costs two model calls rather than one, because the retry loop retries schema failures. That is a small, bounded increase in spend on the failure path, accepted deliberately (see Critical Implementation Details) and asserted by test.

## Migration Notes

Two forward-only migrations, consistent with the AGENTS.md rule that rollback is a new migration rather than an edit.

Both add constraints to existing tables. **Neither is safe against pre-existing violating data** — an `add constraint` fails if any row breaches it. In practice this is a single-user development database and no row should exceed a 1000 g macro or a 2000-character goals field, but if `db reset` fails on either constraint, the violating rows must be inspected before the constraint is forced. Do not widen a constraint to accommodate bad data without deciding whether that data is itself the bug.

## References

- Research (both passes): `context/changes/testing-runner-bootstrap-ai-boundary/research.md`
- Decisions of record: `context/changes/testing-runner-bootstrap-ai-boundary/change.md`
- Risk map and rollout: `context/foundation/test-plan.md` §2, §3
- Migration template: `supabase/migrations/20260620075537_meals_macro_nonneg.sql`
- Bound-both-ends convention: `src/pages/api/biomarkers/index.ts:25-26`
- Free-text triple being mirrored: `src/pages/api/wellness/index.ts:36-38`, `supabase/migrations/20260630120002_wellness_entries.sql:45`, `src/components/wellness/WellnessLogger.tsx:25,296`
- Origin of risk #7: `context/archive/2026-08-01-on-demand-ai-analysis/reviews/impl-review.md` F1
- Preset decision that bounds N: `context/archive/2026-08-01-on-demand-ai-analysis/plan.md:36`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner bootstrap

#### Automated

- [x] 1.1 Suite runs and passes: `npm test` — 6febac8
- [x] 1.2 Linting passes with the new `tests/` tree present: `npm run lint` — 6febac8
- [x] 1.3 Type checking passes with the new `tests/` tree present: `npx astro check` — 6febac8
- [x] 1.4 Build is unaffected: `npm run build` — 6febac8

#### Manual

- [x] 1.5 `vitest.config.ts` contains no reference to `getViteConfig`, and the run produces no Cloudflare-adapter output — 6febac8
- [x] 1.6 Watch mode starts and re-runs on edit: `npm run test:watch` — 6febac8

### Phase 2: Risk #7 — request-boundary lock

#### Automated

- [x] 2.1 All risk-#7 tests pass against unchanged production code: `npm test` — 284d55b
- [x] 2.2 Linting passes: `npm run lint` — 284d55b
- [x] 2.3 Type checking passes: `npx astro check` — 284d55b

#### Manual

- [x] 2.4 `git diff` for this phase touches only `tests/` — 284d55b
- [x] 2.5 Temporarily widening `ANALYSIS_WINDOWS` makes test 7.1 fail; reverted afterwards — 284d55b

### Phase 3: Risk #1 — plausibility guards and tests

#### Automated

- [x] 3.1 All tests pass: `npm test`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Type checking passes: `npx astro check`
- [x] 3.4 Build passes: `npm run build`

#### Manual

- [x] 3.5 Migration applies cleanly against a fresh local stack: `npx supabase db reset`
- [x] 3.6 Reverting either schema guard makes the corresponding test fail
- [x] 3.7 Optional selective mutation check on `macro-schema.ts`; survived mutants judged by user/business impact

### Phase 4: `health_goals` bound

#### Automated

- [ ] 4.1 All tests pass: `npm test`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Type checking passes: `npx astro check`
- [ ] 4.4 Build passes: `npm run build`

#### Manual

- [ ] 4.5 Migration applies cleanly: `npx supabase db reset`
- [ ] 4.6 The profile form stops accepting input at 2000 characters
- [ ] 4.7 An over-long value with the client cap bypassed surfaces the error banner rather than saving

### Phase 5: Cookbook and plan sync

#### Automated

- [ ] 5.1 Full suite still passes: `npm test`
- [ ] 5.2 Linting passes: `npm run lint`

#### Manual

- [ ] 5.3 §6.1, §6.2, and §6.4 contain concrete patterns with file references
- [ ] 5.4 No §6 sub-section touched by this phase still reads "TBD"
- [ ] 5.5 A reader outside this change could add a test for a new endpoint from §6.4 alone
