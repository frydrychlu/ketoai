# Meal Macro Logging (S-01) Implementation Plan

## Overview

Deliver the roadmap north star: a logged-in user types a meal description in plain text (Polish) on `/dashboard`, the app calls OpenRouter from inside the Cloudflare Worker to parse it into macros (fat, protein, carbohydrates, calories), persists the meal as a per-user RLS-protected row, and the day's running macro total updates in place. This slice exercises the core product differentiator (AI macro parsing) end-to-end and retires the project's single riskiest unknown — the first LLM call from a Cloudflare Worker.

## Current State Analysis

- **Auth + SSR are fully wired.** `src/middleware.ts` attaches `context.locals.user` on every request and guards `PROTECTED_ROUTES = ["/dashboard"]`. `src/lib/supabase.ts` is the only Supabase client factory (`createClient(headers, cookies)`), runs every query as the logged-in user, and returns `null` when env is unset.
- **The RLS table pattern is proven** by `supabase/migrations/20260609151323_isolation_canary.sql` (the `isolation_canary` reference: `id`, `user_id → auth.users on delete cascade`, RLS enabled, four granular `to authenticated` policies keyed on `auth.uid() = user_id`). `supabase/tests/isolation_canary_rls.sql` is the re-runnable cross-user proof recipe.
- **Local Supabase now runs** (Docker stack up; Studio `http://127.0.0.1:54323`, db container `supabase_db_10x-astro-starter`). `.env`/`.dev.vars` point at local. Migrations auto-apply on `supabase start`; iterate with `npx supabase db reset`.
- **Existing API routes are form-based and un-validated.** `src/pages/api/auth/signin.ts` uses `formData()` + redirects and no Zod. This slice introduces the **first Zod-validated JSON endpoint**.
- **OpenRouter is half-wired.** `OPENROUTER_API_KEY` exists in the `astro.config.mjs` `env.schema` (`context: "server", access: "secret", optional: true`) — there is **no client code**.
- **Known gaps (confirmed):** `zod` is not installed; `src/types.ts` does not exist; the dashboard (`src/pages/dashboard.astro`) is a placeholder card; shadcn has only `button.tsx`; there is **no test framework** in the repo (CI runs lint + build only).

## Desired End State

A logged-in user on `/dashboard` sees a meal-entry form and "Today's total" (fat / protein / carbs / kcal). They type e.g. `"jajecznica z 3 jajek na maśle"`, submit, see a pending state for a few seconds, then the meal appears in today's list and the total increases — without a full page reload. They can delete a mis-parsed meal and the total drops. A second signed-in user never sees the first user's meals (proven by the copied RLS SQL recipe). On unparseable input, the form shows an inline error and nothing is persisted.

**Verification of end state:** `npm run lint`, `astro sync` typecheck, and `npm run build` all pass; the `meals` RLS isolation recipe passes locally against two users; manual UI walkthrough of log → parse → total-update → delete and the parse-failure path all behave as described.

### Key Discoveries:

- Copy the table + policy shape verbatim from `supabase/migrations/20260609151323_isolation_canary.sql:12` (swap `isolation_canary` → `meals`, add macro/text/day columns).
- The SSR client at `src/lib/supabase.ts:5` already scopes every query to the current user via RLS — no manual `user_id` filtering is needed for SELECT, but INSERT must still set `user_id` to satisfy the `with check` policy.
- `OPENROUTER_API_KEY` is read via `import { OPENROUTER_API_KEY } from "astro:env/server"` (same pattern as `SUPABASE_URL` in `src/lib/supabase.ts:3`).
- React island pattern: `SignInForm.tsx` is a `client:*` React component doing its own local state + validation; `MealLogger` follows it but submits via `fetch` to a JSON API instead of a native form POST.
- The macro service is **I/O-bound `fetch` await**, not CPU — it does not hit the Workers 10 ms free-tier CPU cap (decision recorded in `change.md`).

## What We're NOT Doing

- No per-meal macro breakdown beyond the daily total in the UI (FR-008: daily total only).
- No meal **edit** / re-parse — add + delete only.
- No net-carb / fiber field — a single total-carbs number.
- No timezone stored in a profile; the browser supplies the local date (S-02 stays decoupled).
- No streaming responses; no per-meal AI cost display.
- No new test framework (Vitest etc.) — verification matches current CI reality.
- No trend charts, past-day view, activity/biomarker/wellness logging, or AI analysis (later slices).
- No changes to the existing auth routes' form/redirect style.

## Implementation Approach

Build bottom-up so the riskiest layer is proven before anything depends on it: (1) data + types foundation, (2) isolate and prove the OpenRouter-from-Worker call as a standalone service (the spike), (3) wrap it in Zod-validated JSON API routes that persist via the RLS client, (4) build the `/dashboard` island that drives the loop. Each phase is independently verifiable and committed.

## Critical Implementation Details

- **Day resolution.** The browser sends its local calendar date as an ISO `YYYY-MM-DD` string in the POST body. The server stores it directly in `meals.day` (a `date` column) — it does NOT derive the day from `now()`/UTC. "Today's total" on the server is computed by filtering `day = <date the client reports as today>`; the dashboard page receives the client's today via the island, and the island requests/derives totals for that same date. Treat `day` as authoritative client input, validated by Zod as a strict date.
- **INSERT must set `user_id` explicitly.** RLS `with check (auth.uid() = user_id)` rejects inserts whose `user_id` isn't the caller. Set `user_id` from `context.locals.user.id` server-side; never trust a client-supplied owner.
- **OpenRouter structured output + retry.** Send `response_format: { type: "json_schema", json_schema: {...} }` with a strict macro schema; parse the returned content and validate with Zod. On non-2xx, network error, or Zod failure, retry exactly once; on a second failure throw a typed parse error the API route maps to a 422 with an inline message. Persist nothing on failure.
- **Calories are taken from the model**, stored as returned (decision) — do not recompute server-side.

## Phase 1: Foundations — dependency, migration, types

### Overview

Install Zod, create the `meals` table with the proven RLS pattern (applied to the local DB), copy the isolation proof for `meals`, and declare shared types.

### Changes Required:

#### 1. Add Zod dependency

**File**: `package.json`

**Intent**: Add `zod` as a runtime dependency so API routes can validate inputs and LLM outputs, satisfying the AGENTS.md mandate.

**Contract**: `zod` appears under `dependencies`. Installed via `npm install zod` (so `package-lock.json` updates too). No version pin beyond npm default caret.

#### 2. Meals migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_meals.sql` (timestamp at authoring time, per AGENTS.md filename rule)

**Intent**: Create the per-user `meals` table following the `isolation_canary` pattern exactly, plus the meal-specific columns.

**Contract**: Table `public.meals` with:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users (id) on delete cascade`
- `description text not null` (the raw user text)
- `fat_g numeric not null`, `protein_g numeric not null`, `carbs_g numeric not null`, `calories_kcal numeric not null`
- `day date not null` (the client-reported local calendar date the meal counts toward)
- `logged_at timestamptz not null default now()`
- `enable row level security` + four policies (`meals_select_own`, `meals_insert_own`, `meals_update_own`, `meals_delete_own`) each `to authenticated`, keyed on `auth.uid() = user_id` (writes with `with check`), copied from the canary migration.
- An index on `(user_id, day)` to keep the daily-total filter cheap.

#### 3. Meals RLS isolation proof

**File**: `supabase/tests/meals_rls.sql`

**Intent**: Re-runnable cross-user proof that one user cannot see another's meals — copy of `isolation_canary_rls.sql` swapped to `meals` with two fixed UUIDs and a valid `meals` insert.

**Contract**: Same four-block structure (seed A, seed B, assert B sees only its own, unrestricted sanity check) but inserting the not-null meal columns. Asserts `b_visible_rows` excludes A's rows.

#### 4. Shared types

**File**: `src/types.ts` (new)

**Intent**: Home for the meal entity + DTOs, per AGENTS.md ("new shared types go here").

**Contract**: Export `Meal` (row shape), `MacroBreakdown` (`{ fatG; proteinG; carbsG; caloriesKcal }`), `CreateMealCommand` (`{ description: string; day: string }`), and `DailyMacroTotal` (sum shape). Field names align with the DB columns above.

### Success Criteria:

#### Automated Verification:

- `npm install zod` completes and `zod` is in `package.json` dependencies
- Migration applies cleanly locally: `npx supabase db reset` runs without error
- `meals` table + 4 policies exist: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -c "select polname from pg_policy pol join pg_class c on c.oid=pol.polrelid where c.relname='meals';"` returns 4 rows
- Typecheck passes: `npx astro sync` then `npm run lint`

#### Manual Verification:

- `meals_rls.sql` run against the local db container shows "RLS OK" and user B sees only its own row
- `src/types.ts` types match the migration columns (spot-check)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Macro-parsing service (the OpenRouter spike)

### Overview

Build and prove the first LLM-call-from-a-Worker as an isolated service: a Polish-aware prompt, OpenRouter structured output, Zod validation, retry-once-then-throw. This retires the slice's headline risk before any UI depends on it.

### Changes Required:

#### 1. Macro response schema

**File**: `src/lib/services/macro-schema.ts` (new)

**Intent**: Single source of truth for the parsed-macro shape, used both as the OpenRouter `json_schema` and as the Zod validator.

**Contract**: Export a Zod schema `macroResultSchema` validating `{ fat_g: number≥0, protein_g: number≥0, carbs_g: number≥0, calories_kcal: number≥0 }`, and a matching JSON-schema object literal for `response_format`. Numbers finite and non-negative.

#### 2. OpenRouter macro service

**File**: `src/lib/services/macros.ts` (new)

**Intent**: `parseMealToMacros(description: string): Promise<MacroBreakdown>` — calls OpenRouter chat completions with a Polish system prompt instructing macro estimation for the described meal, requests structured JSON output, validates, and retries once.

**Contract**:
- Reads `OPENROUTER_API_KEY` from `astro:env/server`. Throws a typed `MacroParseError` if the key is missing.
- POSTs to `https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer <key>`, a model constant (default a mid-tier structured-output Claude model via OpenRouter, e.g. `anthropic/claude-haiku-4.5` — confirm the exact slug against OpenRouter's model list at implementation; keep it in one `MODEL` const), `response_format` = the json_schema from macro-schema, `temperature: 0`, and messages: a Polish system prompt + the user's description.
- Parses `choices[0].message.content` as JSON, validates with `macroResultSchema`, maps to `MacroBreakdown`.
- On any failure (non-2xx, fetch throw, JSON parse, Zod fail): retry exactly once; on second failure throw `MacroParseError`. No logging of the API key.

**Note**: Verify locally that `nodejs_compat` + global `fetch` reach OpenRouter from the workerd dev runtime — this is the spike's core unknown.

### Success Criteria:

#### Automated Verification:

- Typecheck/lint pass: `npx astro sync && npm run lint`
- Production build succeeds (service compiles under the Cloudflare adapter): `npm run build`

#### Manual Verification:

- With a real `OPENROUTER_API_KEY` in `.dev.vars`, invoking `parseMealToMacros("jajecznica z 3 jajek na maśle")` from the running local app (temporary dev route or the Phase 3 endpoint) returns a sensible 4-number macro object within a few seconds
- Forcing a bad model response (e.g. temporarily point at a non-schema model or malformed prompt) triggers exactly one retry then a thrown `MacroParseError` — confirmed via server logs
- No API key value appears in any log line

**Implementation Note**: Pause for manual confirmation that the live OpenRouter call works from the Worker before Phase 3.

---

## Phase 3: API routes — create & delete meals

### Overview

Expose the parsing + persistence behind the first Zod-validated JSON endpoints, owning input validation, the parse call, RLS-scoped persistence, and the recomputed daily total.

### Changes Required:

#### 1. Create-meal endpoint

**File**: `src/pages/api/meals/index.ts` (new)

**Intent**: `POST` — validate the request, parse macros, insert the meal as the current user, and return the new meal plus the updated daily total for that `day`.

**Contract**:
- `export const prerender = false;`
- Reject unauthenticated requests (no `context.locals.user`) with 401.
- Parse JSON body, validate with Zod against `CreateMealCommand` (`description` non-empty trimmed string; `day` strict `YYYY-MM-DD`). On invalid input return 400 with field errors.
- Call `parseMealToMacros(description)`. On `MacroParseError` return **422** with `{ error: "<inline message>" }` and persist nothing.
- Insert via `createClient(...)` SSR client with `user_id = context.locals.user.id`, the macro fields, `description`, and `day`.
- Re-query the day's rows for the user and return `{ meal, total: DailyMacroTotal }` as JSON (200/201).

#### 2. Delete-meal endpoint

**File**: `src/pages/api/meals/[id].ts` (new)

**Intent**: `DELETE` — remove one of the caller's meals; RLS guarantees they can only delete their own.

**Contract**:
- `export const prerender = false;`
- 401 if unauthenticated. Validate `id` is a uuid (Zod).
- Delete via the SSR client (RLS `using (auth.uid() = user_id)` enforces ownership). If no row deleted, return 404.
- Return the recomputed `DailyMacroTotal` for the meal's `day` (accept `day` as a query param so the client can refresh its total), or 204 and let the client refetch — return the total to match the in-place update flow.

#### 3. Daily-total helper

**File**: `src/lib/services/meals.ts` (new)

**Intent**: Shared `getDailyTotal(supabase, day)` summing the user's meals for a date, reused by both endpoints.

**Contract**: Selects the user's `meals` rows where `day = <day>` (RLS scopes to user) and returns `DailyMacroTotal` (summed fat/protein/carbs/calories). Sum in JS over the returned rows or via a Postgres aggregate — either is fine at this scale.

### Success Criteria:

#### Automated Verification:

- Typecheck/lint pass: `npx astro sync && npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `POST /api/meals` with a valid Polish description + today's date (via curl or the UI) returns a meal + correct total; the row is visible in Studio
- `POST` with empty `description` or malformed `day` returns 400; unauthenticated returns 401
- A deliberately unparseable description returns 422 and inserts no row
- `DELETE /api/meals/[id]` removes the row and returns the reduced total; deleting another user's id returns 404
- RLS holds: a second user's session cannot fetch/delete the first user's meal

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Dashboard UI — meal logger + today's total

### Overview

Replace the `/dashboard` placeholder with the server-rendered daily total + meal list and a React island that drives the log → parse → update → delete loop with a pending state and inline error.

### Changes Required:

#### 1. Dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Server-render the current user's meals and total for today, and mount the `MealLogger` island seeded with that data.

**Contract**: Using the SSR client + `Astro.locals.user`, query today's meals (server's best guess at the date is fine for first paint; the island reconciles using the browser's local date). Pass initial meals + total as props to `<MealLogger client:load .../>`. Keep the existing `Layout` and sign-out control.

#### 2. MealLogger island

**File**: `src/components/meals/MealLogger.tsx` (new)

**Intent**: Client component owning the entry form, pending state, inline parse-error, today's list, delete, and in-place total update.

**Contract**:
- Props: initial `meals: Meal[]` and `total: DailyMacroTotal`.
- Computes the browser's local date (`new Date()` → `YYYY-MM-DD`) and includes it as `day` in every `POST /api/meals`.
- On submit: disable the form, show a pending indicator, `fetch` the JSON API; on 200 append the meal + replace the total from the response; on 422 show the inline error message; on 400/500 show a generic error. Never clear input on error.
- Each listed meal has a delete control → `DELETE /api/meals/[id]?day=<day>`; on success remove it and apply the returned total.
- Uses `cn()` from `@/lib/utils` for class composition; lucide icons; matches the existing form component style.

#### 3. Macro total display

**File**: `src/components/meals/DailyTotal.tsx` (new, optional — may be inlined in MealLogger)

**Intent**: Presentational fat/protein/carbs/kcal summary.

**Contract**: Pure component taking `DailyMacroTotal`; no data fetching.

### Success Criteria:

#### Automated Verification:

- Typecheck/lint pass: `npx astro sync && npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Logging in and visiting `/dashboard` shows the form + today's total (zeros when empty)
- Submitting a Polish meal shows a pending state, then the meal appears and the total updates without a full reload
- Deleting a meal drops the total in place
- An unparseable description shows the inline error and adds nothing; input is preserved
- A second user sees an empty dashboard (no cross-user leakage)
- No regressions in sign-in/out

**Implementation Note**: Final phase — confirm the full loop manually before closing the change.

---

## Testing Strategy

### Unit Tests:

- None added (no framework in the repo, by decision). The parse/aggregate logic is verified manually and via the daily-total reflecting inserts/deletes.

### Integration Tests:

- Manual end-to-end against the local Supabase stack + live OpenRouter.

### Manual Testing Steps:

1. `npx supabase start` (or confirm running), `npm run dev`, sign in.
2. On `/dashboard`, log `"sałatka z awokado, 2 jajka i oliwa"` → verify pending → meal + total appear.
3. Log a second meal → total increases by the sum.
4. Delete the first meal → total decreases correctly.
5. Submit gibberish (e.g. `"asdfqwer"`) → inline error, no row added (check Studio).
6. Run `supabase/tests/meals_rls.sql` via the db container → "RLS OK", B sees only its own.
7. Sign in as a second user → dashboard empty.

## Performance Considerations

- The OpenRouter call is multi-second I/O wait, surfaced as a pending state — not a CPU concern under the Workers free-tier 10 ms cap. Low QPS (single-user MVP).
- `(user_id, day)` index keeps the daily-total query cheap.

## Migration Notes

- Forward-only (AGENTS.md). The `meals` migration applies locally via `db reset` during dev and reaches cloud via `npx supabase db push` on merge to `master`. No existing data to migrate.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-01)
- Change identity + pre-locked AI decisions: `context/changes/meal-macro-logging/change.md`
- RLS pattern to copy: `supabase/migrations/20260609151323_isolation_canary.sql`
- Isolation proof to copy: `supabase/tests/isolation_canary_rls.sql`
- SSR client: `src/lib/supabase.ts`; React island pattern: `src/components/auth/SignInForm.tsx`
- Local dev flow: `notes/local-dev-flow.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundations — dependency, migration, types

#### Automated

- [x] 1.1 `npm install zod` completes and zod is in package.json dependencies — 27726e9
- [x] 1.2 Migration applies cleanly locally: `npx supabase db reset` runs without error — 27726e9
- [x] 1.3 `meals` table + 4 policies exist (psql pg_policy query returns 4 rows) — 27726e9
- [x] 1.4 Typecheck/lint pass: `npx astro sync && npm run lint` — 27726e9

#### Manual

- [x] 1.5 `meals_rls.sql` shows "RLS OK"; user B sees only its own row — 27726e9
- [x] 1.6 `src/types.ts` types match the migration columns — 27726e9

### Phase 2: Macro-parsing service (the OpenRouter spike)

#### Automated

- [x] 2.1 Typecheck/lint pass: `npx astro sync && npm run lint` — 8114780
- [x] 2.2 Production build succeeds: `npm run build` — 8114780

#### Manual

- [x] 2.3 Live `parseMealToMacros("jajecznica z 3 jajek na maśle")` returns a sensible 4-number macro object within seconds — 8114780
- [x] 2.4 Forced bad response triggers exactly one retry then a thrown MacroParseError — 8114780
- [x] 2.5 No API key value appears in any log line — 8114780

### Phase 3: API routes — create & delete meals

#### Automated

- [x] 3.1 Typecheck/lint pass: `npx astro sync && npm run lint` — 04159bf
- [x] 3.2 Build succeeds: `npm run build` — 04159bf

#### Manual

- [x] 3.3 Valid POST returns meal + correct total; row visible in Studio — 04159bf
- [x] 3.4 Invalid input → 400; unauthenticated → 401 — 04159bf
- [x] 3.5 Unparseable description → 422 with no row inserted — 04159bf
- [x] 3.6 DELETE removes own row and returns reduced total; other user's id → 404 — 04159bf
- [x] 3.7 RLS holds across two users (no cross-user fetch/delete) — 04159bf

### Phase 4: Dashboard UI — meal logger + today's total

#### Automated

- [x] 4.1 Typecheck/lint pass: `npx astro sync && npm run lint`
- [x] 4.2 Build succeeds: `npm run build`

#### Manual

- [x] 4.3 `/dashboard` shows form + today's total (zeros when empty)
- [x] 4.4 Submitting a Polish meal shows pending, then meal + total update without full reload
- [x] 4.5 Deleting a meal drops the total in place
- [x] 4.6 Unparseable description shows inline error, adds nothing, preserves input
- [x] 4.7 Second user sees an empty dashboard; no sign-in/out regressions
