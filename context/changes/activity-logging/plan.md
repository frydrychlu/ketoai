# Physical Activity Logging with Estimated Calories (S-04) Implementation Plan

## Overview

Let a logged-in user log a physical activity by describing it in plain text (e.g. "30 min biegania")
and immediately see an **approximate caloric expenditure** estimate the app derives from an LLM call;
today's activities sum into a daily expenditure total on the dashboard. Activities are a one-to-many
time-series like meals — each is its own row keyed to the client's local `day`. The estimator reuses
the OpenRouter request boundary proven and de-risked in S-01 (`meal-macro-logging`): a synchronous,
structured-JSON call validated with Zod, retried once on transient failure then rejected. The only
substantive difference from meals is that the model returns **one number (calories)** instead of four
macros, and the prompt is about exercise rather than food. The estimate is stored as-is, labeled
approximate, and never user-edited. This slice carries no new platform risk; it produces the
activity-expenditure series that S-07's diet/activity correlation will later consume.

## Current State Analysis

- **The slice template is proven three times over.** S-01 `meal-macro-logging` established the exact
  shape this slice copies: a per-user RLS table with a `day date` column + a `(user_id, day)` index
  (`supabase/migrations/20260615182411_meals.sql`), a service (`src/lib/services/meals.ts`), a
  Zod-validated JSON API with `GET`/`POST` (`src/pages/api/meals/index.ts`) and `DELETE`
  (`src/pages/api/meals/[id].ts`), and a `client:load` fetch island with a daily total
  (`src/components/meals/MealLogger.tsx` + `DailyTotal.tsx`). S-03 `biomarker-gki-logging` is being
  added in parallel as a fourth example of the same table/RLS/island shape.
- **The AI boundary is a self-contained, copyable module.** `src/lib/services/macros.ts` posts to
  OpenRouter (`https://openrouter.ai/api/v1/chat/completions`, model `anthropic/claude-haiku-4.5`,
  `temperature: 0`) with `response_format: { type: "json_schema", json_schema: ... }`, validates the
  result with a Zod schema, and retries exactly once — only on transient 5xx (`OpenRouterError.retryable`),
  failing fast on 4xx — before throwing `MacroParseError`. The JSON schema + Zod validator are twins
  in `src/lib/services/macro-schema.ts` (single source of truth for the model output shape). The key
  comes from `OPENROUTER_API_KEY` via `astro:env/server`.
- **The route maps an AI failure to an inline error.** `src/pages/api/meals/index.ts:88` catches
  `MacroParseError` and returns `422` with a Polish message; the island surfaces it inline and
  persists nothing (honors the no-silent-draft NFR). This is the exact contract S-04 reuses.
- **Auth + SSR + RLS are wired.** `src/middleware.ts` guards `PROTECTED_ROUTES`
  (`["/dashboard","/profile"]`) and attaches `context.locals.user`. `/dashboard` is already protected
  — **no middleware change needed**. `src/lib/supabase.ts` is the only client factory; it scopes
  every query to the logged-in user via RLS and returns `null` when env is unset.
- **`src/types.ts` is the home for shared types** (AGENTS.md); it already holds the meals, profile,
  and (in parallel) biomarker DTOs. This slice appends the activity entity + command.
- **S-02 `health-profile` is done**, so `weight_kg` exists — but the locked decision is to NOT consume
  it (free-text-only estimator), keeping S-04's prerequisites = F-01 only and avoiding the nullable-weight
  edge case.
- **RLS table + proof pattern to copy:** `supabase/migrations/20260609151323_isolation_canary.sql`
  (table + `user_id → auth.users on delete cascade` + `enable RLS` + four granular `to authenticated`
  policies keyed on `auth.uid() = user_id`) and the re-runnable proof `supabase/tests/meals_rls.sql`.
- **No test framework** in the repo — CI runs lint + build only. Verification matches that reality
  (lint, `astro sync` typecheck, build, plus the SQL RLS recipe + manual UI walkthrough).

## Desired End State

A logged-in user on `/dashboard` sees an "Activity" section (a third island below meals and
biomarkers). It shows today's logged activities and a headline **daily expenditure total** (sum of
their estimated calories). They type "45 min spokojny rower" and submit; the app calls the LLM, gets
an estimate (e.g. ~350 kcal), saves the activity, appends it to the list, and updates the daily total
— without a full page reload, with the estimate labeled approximate. Each activity row has a delete
that removes it and recomputes the total. If the estimate fails after one retry, an inline error is
shown and nothing is saved. A second signed-in user never sees the first user's activities (proven by
the copied RLS SQL recipe). Visiting `/dashboard` while logged out redirects to `/auth/signin`
(unchanged).

**Verification of end state:** `npm run lint`, `astro sync` typecheck, and `npm run build` all pass;
the `activities` RLS isolation recipe passes locally against two users; manual walkthrough of
log → see-estimate → daily-total-updates → delete → estimate-failure-rejects all behave as described.

### Key Discoveries:

- **Schema = meals minus three macro columns.** Copy `meals.sql` → `activities`: `id`, `user_id` FK
  cascade, `description text not null`, `calories_kcal numeric not null`, `day date not null`,
  `logged_at timestamptz default now()`, a non-unique `(user_id, day)` index, `enable RLS` + the four
  granular policies. Activities are many-per-day, so **no** `unique` constraint (unlike S-03).
- **The estimator is `macros.ts` with a one-number schema.** A new `src/lib/services/activity-estimate.ts`
  mirrors `macros.ts` structure (endpoint, model, retry-once, `OpenRouterError`/`ActivityEstimateError`)
  with an activity-specific Polish system prompt and an `activity-estimate-schema.ts` twin whose JSON
  schema + Zod both describe `{ calories_kcal: number }`.
- **`calories_kcal not null` because estimate-failure rejects the whole entry** (locked decision) —
  there is never a stored activity without an estimate, so no nullable-calorie plumbing downstream.
- **Daily total reuses the meals sum approach** (`src/lib/services/meals.ts:24` `getDailyTotal`):
  a single-column SELECT filtered by `day`, summed server-side. Here it sums one column, returning a
  `DailyExpenditureTotal` (`{ calories_kcal }`).
- **DELETE is id-keyed**, mirroring `src/pages/api/meals/[id].ts` exactly (UUID-validate the param,
  delete by id, RLS scopes to the owner so a stray id affects zero rows → 404, then recompute the
  day's total and return it).
- **No middleware change** — `/dashboard` is already in `PROTECTED_ROUTES`.
- **The island computes the local day** with a `localDay()` helper identical to `MealLogger.tsx:11`.

## What We're NOT Doing

- **No body-weight / profile coupling** — the estimator sees only the free-text description (locked).
  No `weight_kg` from S-02 in the prompt; S-04 stays independent of S-02.
- **No manual override of the estimate** — the AI number is stored as-is (like un-edited meal macros);
  correcting it means delete + re-describe.
- **No structured duration/intensity fields** — a single free-text input; duration lives in the prose.
- **No nullable/zero-calorie activities** — a failed estimate rejects the entry (no silent draft).
- **No net-energy / intake-minus-expenditure math** — combining activity with meals is the S-07
  correlation slice, not this one. This slice shows activity expenditure only.
- **No trend charts or history** — only today's activities + today's total. Charting is S-06/S-07;
  past-day read-back is S-08.
- **No edit of a past day** — only today's logging via the dashboard island.
- **No new page or nav** — a dashboard island; no `/activity` route, no middleware change.
- **No new AI model/config plumbing** — reuse the existing `OPENROUTER_API_KEY` + endpoint/model
  already wired for meals.
- **No new test framework** — verification matches current CI (lint + build) plus the SQL RLS recipe.
- **No changes to the meals, profile, or biomarker slices** or the auth routes.

## Implementation Approach

Bottom-up, mirroring S-01 so each layer is verifiable before the next depends on it: (1) data + types
foundation (migration copied from `meals` minus the macro columns, RLS proof, shared types); (2) the
activity estimator (a `macros.ts` twin with a one-number schema) + the activities service (insert +
daily sum) + the Zod-validated `GET`/`POST`/`DELETE` JSON API; (3) the `ActivityLogger` dashboard
island and its wiring as the third island on `/dashboard`. Each phase is independently committed.

## Critical Implementation Details

- **Reuse, don't re-invent, the OpenRouter call shape.** The estimator must keep `macros.ts`'s
  proven decisions: `temperature: 0`, `response_format` structured JSON, validate with Zod before
  trusting, retry exactly once and only on transient 5xx (a 4xx fails fast — a bad key won't fix
  itself on retry). Throw a dedicated `ActivityEstimateError` so the route can map it to a 422
  inline error exactly like `MacroParseError`. Keep the model slug in one place (it's
  `anthropic/claude-haiku-4.5` today).
- **`calories_kcal` is `not null` and the POST is all-or-nothing.** Because a failed estimate rejects
  the entry, the insert always has a real number — mirror the meals POST: validate body → call
  estimator (catch → 422) → insert with `user_id` from `context.locals.user.id` (RLS `with check`) →
  recompute and return the daily total.
- **`day` is the client's local calendar date**, supplied by the island (not derived from UTC
  `now()`), so activities group under the correct day across timezones — identical to the meals `day`
  contract.
- **Estimate labeling.** The UI must visibly mark the calorie figure as approximate (PRD-accepted
  tradeoff) — e.g. a "~" prefix or an "estimate" caption — on both the per-row figure and the daily
  total.

## Phase 1: Foundations — migration, RLS proof, types

### Overview

Create the `activities` time-series table on the proven RLS pattern (copied from `meals` minus the
three extra macro columns), copy the isolation proof for it, and declare the shared activity types.

### Changes Required:

#### 1. Activities migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_activities.sql` (timestamp at authoring time, per AGENTS.md filename rule; must sort after the latest existing migration)

**Intent**: Create the per-user `activities` time-series table following the `isolation_canary` +
`meals` pattern, with a free-text description, the estimated calories, and the local `day`.

**Contract**: Table `public.activities` with:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users (id) on delete cascade`
- `description text not null` — the raw text the user typed (kept for re-display + later S-07/S-09 context)
- `calories_kcal numeric not null`, `check (calories_kcal >= 0)` — the AI estimate (non-negative; a
  failed estimate never reaches insert, so this is always present)
- `day date not null` — the client-reported local calendar date the activity counts toward
- `logged_at timestamptz not null default now()`
- a non-unique index on `(user_id, day)` (copy `meals_user_id_day_idx`) — many activities per day, so
  **no** unique constraint
- `enable row level security` + four policies (`activities_select_own`, `_insert_own`, `_update_own`,
  `_delete_own`), each `to authenticated`, keyed on `auth.uid() = user_id` (writes with `with check`),
  copied verbatim from the meals/canary migration.

#### 2. Activities RLS isolation proof

**File**: `supabase/tests/activities_rls.sql`

**Intent**: Re-runnable cross-user proof that one user cannot see another's activities — a copy of
`supabase/tests/meals_rls.sql` swapped to `activities`.

**Contract**: Same four-block structure (seed user A's activities, seed user B's activity, impersonate
B and assert it sees only its own rows, unrestricted sanity check showing both). Insert valid rows
with all not-null columns filled — `description`, a `calories_kcal` (e.g. 200/318/69), `day = current_date`.
Asserts B's visible rows exclude A's.

#### 3. Shared types

**File**: `src/types.ts` (append)

**Intent**: Home for the activity entity + create command + daily-expenditure total, per AGENTS.md.

**Contract**: Export `Activity` (row shape: `id`, `user_id`, `description`, `calories_kcal`, `day`,
`logged_at` — field names mirror the DB columns, like the meals types), `CreateActivityCommand`
(`description`, `day` — **no `calories_kcal`**, since the server estimates it), and
`DailyExpenditureTotal` (`{ calories_kcal: number }`, the daily sum shape).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly locally: `npx supabase db reset` runs without error
- Table + 4 policies exist: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -c "select polname from pg_policy pol join pg_class c on c.oid=pol.polrelid where c.relname='activities';"` returns 4 rows
- `(user_id, day)` index exists: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -c "\d public.activities"` shows the index
- Typecheck/lint pass: `npx astro sync && npm run lint`

#### Manual Verification:

- `activities_rls.sql` run against the local db container shows the proof passing — user B sees only its own rows
- `src/types.ts` activity types match the migration columns (spot-check)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Activity estimator + service + JSON API route

### Overview

Add the OpenRouter activity-calorie estimator (a `macros.ts` twin returning one number), an activities
service (insert + daily sum), and a Zod-validated JSON API at `src/pages/api/activities/index.ts`
(`GET` today's activities + total, `POST` estimate-and-save) plus `[id].ts` (`DELETE`).

### Changes Required:

#### 1. Activity-estimate schema (JSON-schema + Zod twin)

**File**: `src/lib/services/activity-estimate-schema.ts` (new)

**Intent**: Single source of truth for the estimator's output shape, mirroring `macro-schema.ts`.

**Contract**: Export `activityEstimateResultSchema` (Zod: `z.object({ calories_kcal: z.number().min(0) })`)
and `activityEstimateJsonSchema` (the OpenRouter `response_format` literal: `name`, `strict: true`,
one required numeric property `calories_kcal`, `additionalProperties: false`).

#### 2. Activity estimator service

**File**: `src/lib/services/activity-estimate.ts` (new)

**Intent**: Estimate caloric expenditure for a free-text activity description via OpenRouter — the
S-01 boundary reused with an activity prompt and one-number output.

**Contract**: Mirror `src/lib/services/macros.ts` exactly in structure:
- `export class ActivityEstimateError extends Error` (analogue of `MacroParseError`).
- `estimateActivityCalories(description: string): Promise<number>` — guard missing
  `OPENROUTER_API_KEY`; one attempt + one retry, retry only on transient 5xx (reuse the same private
  `OpenRouterError { retryable }` pattern); `temperature: 0`; `response_format` =
  `activityEstimateJsonSchema`; validate the parsed content with `activityEstimateResultSchema`;
  return `calories_kcal`. Reuse the `extractJsonObject` defensive-parse helper.
- System prompt (Polish, activity-flavored): instruct the model that the user describes in Polish a
  physical activity they performed; estimate the TOTAL calories burned (kcal) from typical values for
  that activity and any duration mentioned; return only a JSON object with the single numeric key
  `calories_kcal`, no units or extra text.

#### 3. Activities service

**File**: `src/lib/services/activities.ts` (new)

**Intent**: Read/sum/insert the user's activities — the single place the route and (future slices)
reuse.

**Contract**:
- `sumDailyExpenditure(rows: { calories_kcal: number }[]): DailyExpenditureTotal` — pure sum (mirror
  `sumDailyTotal` in `meals.ts`).
- `getDailyExpenditure(supabase, day): Promise<DailyExpenditureTotal>` — SELECT `calories_kcal`
  filtered by `day` (RLS scopes to the user), summed via `sumDailyExpenditure`.
- (Insert can be done inline in the route as meals does, or add `insertActivity(...)` here for
  symmetry — implementer's choice; keep `user_id` set explicitly from the caller.)

#### 4. Activities API route — list + create

**File**: `src/pages/api/activities/index.ts` (new)

**Intent**: `GET` today's activities + expenditure total; `POST` a description → estimate → save →
return the new row + updated total. Mirror `src/pages/api/meals/index.ts`.

**Contract**:
- `export const prerender = false;`
- Reuse a `daySchema` identical to the meals route (regex `^\d{4}-\d{2}-\d{2}$` + real-date `refine`).
- `createActivitySchema = z.object({ description: z.string().trim().min(1, "<Polish: opis aktywności jest wymagany>"), day: daySchema })`.
- 401 when `context.locals.user` is absent; 500 when `createClient(...)` returns null.
- `GET /api/activities?day=YYYY-MM-DD` → validate `day`; SELECT the day's activities ordered by
  `logged_at` asc; return `{ activities, total }` (total summed from the fetched rows).
- `POST /api/activities` → parse JSON body (400 on bad JSON); validate (400 +
  `z.flattenError(...).fieldErrors`); call `estimateActivityCalories(description)` — on
  `ActivityEstimateError` return `422` with a Polish message ("Nie udało się oszacować spalonych
  kalorii. Spróbuj opisać aktywność inaczej."); insert `{ user_id, description, day, calories_kcal }`;
  return `{ activity, total }` with `201` (total via `getDailyExpenditure`).

#### 5. Activities API route — delete

**File**: `src/pages/api/activities/[id].ts` (new)

**Intent**: `DELETE` an activity by id and return the recomputed daily total. Mirror
`src/pages/api/meals/[id].ts`.

**Contract**: `export const prerender = false;` UUID-validate `context.params.id` (400 on bad id);
401/500 guards as above; `.delete().eq("id", id).select().single()` (RLS scopes to owner; no row →
404); on success recompute `getDailyExpenditure(supabase, deleted.day)` and return `{ total }` with `200`.

### Success Criteria:

#### Automated Verification:

- Typecheck/lint pass: `npx astro sync && npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `POST /api/activities` with `{day, description:"30 min biegania"}` returns an `activity` with a plausible `calories_kcal` and `201`; row visible in Studio
- `GET /api/activities?day=` returns the day's activities ordered by `logged_at` and a `total` equal to their sum
- A second POST appends another activity (many-per-day; no upsert) and the total grows
- `DELETE /api/activities/{id}` removes the row, returns the recomputed `total` (`200`); a deleted-then-redeleted id returns `404`
- A `POST` with an empty description returns `400`; an estimate failure path returns `422` (simulate by temporarily unsetting the key) and persists nothing
- Unauthenticated `GET`/`POST`/`DELETE` are rejected with `401`

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: UI — ActivityLogger dashboard island

### Overview

Add an `ActivityLogger` React island (meals-style: fetch today's activities + total on mount, submit a
description, show the estimate in place, per-row delete, daily expenditure total labeled approximate)
and mount it as the third island on `/dashboard`.

### Changes Required:

#### 1. ActivityLogger island

**File**: `src/components/activities/ActivityLogger.tsx` (new)

**Intent**: Client island mirroring `MealLogger` — computes the local day, fetches today's activities
+ total on mount, posts a description, appends the returned activity, shows the daily expenditure
total, and offers per-row delete.

**Contract**:
- Compute the browser's local date with a `localDay()` helper identical to `MealLogger.tsx:11`
  (duplicate the four lines, matching the existing pattern, unless trivially shared via `@/lib/utils`).
- On mount: `fetch("/api/activities?day=" + day)`; populate the activity list + total from
  `{ activities, total }`. Use an `AbortController` cleanup like `MealLogger`.
- A single text input + submit button. On submit: `POST` JSON `{ description, day }`; while pending,
  show a "Szacuję…" busy state (mirror MealLogger's "Analizuję…"); on success append the activity and
  set the new total, clear the input; on a non-OK response surface `data.error` inline.
- Render the **daily expenditure total** as a headline figure (reuse `DailyTotal`'s card styling, or a
  small single-metric variant) and the activity list with each row's description + its estimated
  calories, **visibly labeled approximate** (e.g. "~350 kcal"). Each row has a `Trash2` delete that
  calls `DELETE /api/activities/{id}` and updates the list + total from the response.
- Use `cn()` from `@/lib/utils`, the `Button` primitive, lucide icons, and the existing dashboard
  styling (`bg-white/5`, `border-white/10`, etc.).

#### 2. Mount on the dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Render the activity island as the third logging island.

**Contract**: Import `ActivityLogger` and mount `<ActivityLogger client:load />` inside the existing
card container (below the meals and biomarker islands), with a small "Activity" section heading
consistent with the other sections. Optionally group the three islands with light presentational
spacing/dividers — presentational only, no behavior change. No middleware change.

### Success Criteria:

#### Automated Verification:

- Typecheck/lint pass: `npx astro sync && npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Logged-in user on `/dashboard` sees an empty Activity section (zero daily expenditure) on a day with no activities
- Submitting "45 min rower" shows a busy state, then appends the activity with an approximate calorie estimate and updates the daily total — no full reload
- Logging a second activity appends it and grows the total
- Deleting an activity removes it and decreases the total
- An empty submit is blocked/inline-errored; an estimate failure shows an inline error and persists nothing
- The calorie figures are visibly labeled approximate
- Reloading `/dashboard` re-fetches and shows today's activities + total
- Visiting `/dashboard` while logged out redirects to `/auth/signin`; a second user sees an empty Activity section (no cross-user leakage); no regressions to the meal or biomarker islands or sign-in/out

**Implementation Note**: Final phase — confirm the full log → estimate → total-updates → delete loop manually before closing the change.

---

## Testing Strategy

### Unit Tests:

- None added (no framework in the repo, by decision). The estimator boundary, validation, and daily
  sum are verified manually and via the SQL RLS recipe. `sumDailyExpenditure` and the estimator are
  written as small pure/isolated functions so a runner could be added later without refactoring.

### Integration Tests:

- Manual end-to-end against the local Supabase stack + a live `OPENROUTER_API_KEY`.

### Manual Testing Steps:

1. `npx supabase start` (or confirm running), ensure `OPENROUTER_API_KEY` is set in `.dev.vars`, `npm run dev`, sign in.
2. On `/dashboard`, the Activity section is empty (0 kcal expenditure today).
3. Type "30 min biegania" → submit → busy state → activity appears with ~N kcal; daily total = N.
4. Type "60 min spacer" → submit → second activity appears; total grows.
5. Delete the first activity → it disappears; total drops accordingly.
6. Submit an empty description → blocked/inline error, nothing saved.
7. Temporarily unset the API key (or simulate a failure) → submit → inline error, nothing saved.
8. Reload `/dashboard` → today's activities + total reappear.
9. Run `supabase/tests/activities_rls.sql` via the db container → proof passes, B sees only its own.
10. Sign in as a second user → empty Activity section; meals / biomarkers / profile / sign-out still work.

## Performance Considerations

- One synchronous LLM call per activity submit — `fetch` await is I/O wait, not CPU, so the Workers
  free-tier 10 ms CPU cap is not the bottleneck (same reasoning as S-01). Reads/sum are a single
  indexed query per day. No load concern at MVP single-user scale.

## Migration Notes

- Forward-only (AGENTS.md). The `activities` migration applies locally via `db reset` during dev and
  reaches cloud via `npx supabase db push` on merge to `master`. No existing data to migrate.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-04)
- PRD: FR-005 — `context/foundation/prd.md`
- Change identity + locked decisions: `context/changes/activity-logging/change.md`
- Time-series slice to mirror (table + JSON API + island + daily total): `context/changes/meal-macro-logging/plan.md`,
  `supabase/migrations/20260615182411_meals.sql`, `src/pages/api/meals/index.ts`,
  `src/pages/api/meals/[id].ts`, `src/components/meals/MealLogger.tsx`, `src/components/meals/DailyTotal.tsx`,
  `src/lib/services/meals.ts`
- AI boundary to reuse: `src/lib/services/macros.ts`, `src/lib/services/macro-schema.ts`
- RLS pattern + proof to copy: `supabase/migrations/20260609151323_isolation_canary.sql`, `supabase/tests/meals_rls.sql`
- SSR client: `src/lib/supabase.ts`; route protection (unchanged): `src/middleware.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundations — migration, RLS proof, types

#### Automated

- [ ] 1.1 Migration applies cleanly locally: `npx supabase db reset` runs without error
- [ ] 1.2 Table + 4 policies exist (psql pg_policy query returns 4 rows)
- [ ] 1.3 `(user_id, day)` index exists (`\d public.activities`)
- [x] 1.4 Typecheck/lint pass: `npx astro sync && npm run lint` — 58432cf

#### Manual

- [ ] 1.5 `activities_rls.sql` proof passes; user B sees only its own rows
- [ ] 1.6 `src/types.ts` activity types match the migration columns

### Phase 2: Activity estimator + service + JSON API route

#### Automated

- [x] 2.1 Typecheck/lint pass: `npx astro sync && npm run lint`
- [x] 2.2 Build succeeds: `npm run build`

#### Manual

- [ ] 2.3 Valid POST returns an activity with a plausible `calories_kcal` and `201`; row visible in Studio
- [ ] 2.4 GET returns the day's activities ordered by `logged_at` and a `total` equal to their sum
- [ ] 2.5 A second POST appends another activity (many-per-day) and the total grows
- [ ] 2.6 DELETE removes the row and returns the recomputed total (`200`); redelete returns `404`
- [ ] 2.7 Empty description returns `400`; estimate failure returns `422`, persists nothing
- [ ] 2.8 Unauthenticated GET/POST/DELETE rejected with `401`

### Phase 3: UI — ActivityLogger dashboard island

#### Automated

- [ ] 3.1 Typecheck/lint pass: `npx astro sync && npm run lint`
- [ ] 3.2 Build succeeds: `npm run build`

#### Manual

- [ ] 3.3 Empty Activity section (0 kcal) on a day with no activities
- [ ] 3.4 Submit shows a busy state, then appends the activity with an approximate estimate and updates the daily total (no full reload)
- [ ] 3.5 A second activity appends and grows the total
- [ ] 3.6 Delete removes an activity and decreases the total
- [ ] 3.7 Empty submit blocked/inline-errored; estimate failure shows inline error, persists nothing
- [ ] 3.8 Calorie figures are visibly labeled approximate
- [ ] 3.9 Reloading `/dashboard` re-fetches today's activities + total
- [ ] 3.10 Logged-out `/dashboard` redirects to signin; second user sees empty section; no regressions
