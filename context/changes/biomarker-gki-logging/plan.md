# Biomarker Logging with Automatic GKI (S-03) Implementation Plan

## Overview

Let a logged-in user record one blood-ketone (mmol/L) + blood-glucose (mg/dL) reading per
calendar day and immediately see the **GKI** (glycemic-ketone index) the app computes for them.
GKI = (glucose ÷ 18) ÷ ketones is calculated deterministically server-side on save and stored
alongside the inputs; the user never types GKI directly and the units are fixed (FR-006). The
reading is a **singleton per (user, day)** — re-logging the same day upserts the row — protected
by the same per-user RLS pattern every other table follows, surfaced as a React island on
`/dashboard` next to the existing meal logger, with an in-place GKI readout and a delete/clear
action. This slice has no AI call and no novel platform risk; it is a pure-function computation
on a freshly-proven template, and it produces the time-series S-06's trend dashboard will chart.

## Current State Analysis

- **The slice template exists and is proven twice.** S-01 `meal-macro-logging` established the
  one-to-many time-series shape: an RLS table with a `day date` column and a
  `(user_id, day)` index (`supabase/migrations/20260615182411_meals.sql`), a service
  (`src/lib/services/meals.ts`), a Zod-validated JSON API (`src/pages/api/meals/index.ts` +
  `[id].ts` for DELETE), and a `client:load` fetch-based island (`src/components/meals/MealLogger.tsx`)
  on `/dashboard`. S-02 `health-profile` established the **singleton upsert**: a `unique (user_id)`
  constraint + `.upsert(..., { onConflict: "user_id" })` (`src/lib/services/profile.ts:29`) with
  range/enum CHECK guards (`supabase/migrations/20260617072330_health_profiles.sql`).
- **This slice blends the two.** It has meals' `day` column but is a singleton **per (user, day)**:
  `unique (user_id, day)` + upsert on that two-column conflict target. The UI is meals-style
  (dashboard island, JSON fetch, in-place feedback), not profile-style (separate page, native POST).
- **Auth + SSR + RLS are wired.** `src/middleware.ts` guards `PROTECTED_ROUTES = ["/dashboard","/profile"]`
  and attaches `context.locals.user`. `/dashboard` is already protected — **no middleware change is
  needed** for this slice. `src/lib/supabase.ts` is the only client factory; it scopes every query
  to the logged-in user via RLS and returns `null` when env is unset.
- **The meals API is the precedent to mirror for the route shape:** `GET /api/meals?day=` validates
  the day with a `daySchema` (regex + real-date `refine`), `POST` validates the body with Zod and
  sets `user_id` explicitly from `context.locals.user.id` to satisfy the RLS `with check`, `DELETE`
  lives at `[id].ts`. Errors are JSON `{ error }` with appropriate status codes.
- **`src/types.ts` is the home for shared types** (AGENTS.md). It already holds the meals and
  profile DTOs; this slice appends the biomarker entity + command.
- **RLS table + proof pattern to copy:** `supabase/migrations/20260609151323_isolation_canary.sql`
  (table + `user_id → auth.users on delete cascade` + `enable RLS` + four granular `to authenticated`
  policies keyed on `auth.uid() = user_id`) and the re-runnable proof `supabase/tests/meals_rls.sql`.
- **Local Supabase runs in Docker** (db container `supabase_db_10x-astro-starter`, Studio
  `http://127.0.0.1:54323`); migrations auto-apply on `supabase start`, iterate with
  `npx supabase db reset`. `.env`/`.dev.vars` point at local.
- **No test framework** in the repo — CI runs lint + build only. Verification matches that reality
  (lint, `astro sync` typecheck, build, plus the SQL RLS recipe + manual UI walkthrough).

## Desired End State

A logged-in user on `/dashboard` sees a "Biomarkers" section beneath (or beside) the meal logger.
On load it shows today's reading if one exists (ketones, glucose, and the computed GKI), or an empty
form. They enter a ketone value (e.g. `1.5`) and a glucose value (e.g. `90`) and save; the GKI
(`90 ÷ 18 ÷ 1.5 = 3.3`) appears in place without a full page reload. Saving again with different
numbers **overwrites** today's reading (still one row for the day). A delete/clear action removes the
day's reading and returns the section to its empty state. Entering ketones `0` (or a value ≤ 0), an
out-of-range number, or omitting a field is rejected — the reading is not saved and the user sees an
inline error. A second signed-in user never sees the first user's readings (proven by the copied RLS
SQL recipe). Visiting `/dashboard` while logged out redirects to `/auth/signin` (unchanged).

**Verification of end state:** `npm run lint`, `astro sync` typecheck, and `npm run build` all pass;
the `biomarker_readings` RLS isolation recipe passes locally against two users; manual walkthrough of
log → see-GKI → re-log-overwrites → delete → reject-invalid all behave as described.

### Key Discoveries:

- **Schema = meals' `day` + profile's singleton upsert.** Copy the table + four policies from
  `isolation_canary` (as `meals.sql` did), add a `day date not null` column and a
  `unique (user_id, day)` constraint (the upsert conflict target — analogous to profile's
  `unique (user_id)`).
- **GKI is a stored, NOT NULL column** computed on save. Because both inputs are required and
  ketones is constrained `> 0`, GKI is always a finite real number — no nullable-GKI plumbing.
- **Ketones `> 0` is the div-by-zero guard.** A `check (ketones_mmol_l > 0)` in the DB plus a Zod
  `min(0.1)` in the route means the `(glucose / 18) / ketones` computation never divides by zero.
- **Upsert needs the full column set, including the freshly-computed `gki`.** Mirror
  `upsertProfile` (`src/lib/services/profile.ts:34`): build the payload with every column explicitly
  (`user_id`, `day`, `ketones_mmol_l`, `glucose_mg_dl`, `gki`, `updated_at`) and `{ onConflict: "user_id,day" }`.
  `updated_at` is set explicitly because the column default fires only on insert.
- **DELETE is day-keyed, not id-keyed.** Because the row is the day's singleton, `DELETE
  /api/biomarkers?day=YYYY-MM-DD` is cleaner than the meals `[id].ts` shape — RLS still scopes the
  delete to the caller's own row, so a stray day affects zero rows.
- **No middleware change** — `/dashboard` is already in `PROTECTED_ROUTES`.
- **The island fetches `?day=` with the browser's local date**, exactly like `MealLogger` computes
  `localDay()` (`src/components/meals/MealLogger.tsx:11`) — the day the reading counts toward is the
  client's local calendar date, not UTC `now()`.

## What We're NOT Doing

- **No multiple readings per day** — the locked decision is one singleton row per (user, day);
  re-logging overwrites. (Intra-day GKI resolution is out of scope; revisit if S-06 needs it.)
- **No breath ketones, no unit toggle** — ketones always mmol/L, glucose always mg/dL (PRD: units
  are fixed). No mmol/L glucose, no imperial.
- **No user-entered GKI** — GKI is always derived (FR-006).
- **No partial readings** — both ketones and glucose are required; a reading without both is rejected
  (so every stored row has a valid GKI).
- **No trend charts / history view** — this slice only logs and shows *today's* reading. Charting the
  time-series is S-06 (`biomarker-trend-dashboard`); past-day read-back is S-08.
- **No edit-of-a-past-day** — only today's reading is logged/edited via the dashboard. (Re-log = edit
  of today.)
- **No new page or nav** — the UI is a dashboard island; no `/biomarkers` route, no middleware change.
- **No new test framework** — verification matches current CI (lint + build) plus the SQL RLS recipe.
- **No changes to the meals or profile slices** or the auth routes.

## Implementation Approach

Bottom-up, mirroring S-01/S-02 so each layer is verifiable before the next depends on it:
(1) data + types foundation (migration with the `(user_id, day)` singleton + range/positivity guards
+ stored `gki`, RLS proof, shared types); (2) the GKI compute helper + reading service + Zod-validated
JSON API (`GET`/`POST`/`DELETE`); (3) the `BiomarkerLogger` dashboard island and its wiring into
`/dashboard`. Each phase is independently committed.

## Critical Implementation Details

- **GKI computation is a single pure function, server-side only.** `computeGki(glucoseMgDl,
  ketonesMmolL) = (glucoseMgDl / 18) / ketonesMmolL`. It is called once in the service before the
  upsert and its result is stored. Keep it pure and unit-test-shaped (even without a runner) so S-06
  and S-09 can reuse the exact same formula. Guard its precondition (`ketones > 0`) at the Zod/DB
  layer, not inside the function — the function assumes a valid positive ketone.
- **Upsert must write the computed `gki` and every column explicitly.** Like `upsertProfile`, build
  the payload object with all columns present (no spread of a partial object): `user_id`, `day`,
  `ketones_mmol_l`, `glucose_mg_dl`, `gki`, `updated_at`. Use `{ onConflict: "user_id,day" }`. RLS
  `with check (auth.uid() = user_id)` still requires `user_id` set from `context.locals.user.id` —
  never trust a client-supplied owner.
- **`day` is the client's local calendar date**, supplied by the island (not derived from UTC
  `now()`), so the reading groups under the correct day across timezones — identical to the meals
  `day` contract.
- **GKI precision.** Store the computed value as `numeric` (full precision); round to 1 decimal only
  for display in the island (mirrors `DailyTotal`'s `round()` and `Math.round` display rounding).
  Do not round before storing — S-06/S-09 may want the precise value.

## Phase 1: Foundations — migration, RLS proof, types

### Overview

Create the singleton-per-day `biomarker_readings` table with the proven RLS pattern plus the
positivity/range guards and the stored `gki` column, copy the isolation proof for it, and declare the
shared biomarker types.

### Changes Required:

#### 1. Biomarker-readings migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_biomarker_readings.sql` (timestamp at authoring time, per AGENTS.md filename rule; must sort after the latest existing migration `20260620075537`)

**Intent**: Create the per-(user, day) singleton `biomarker_readings` table following the
`isolation_canary` + `meals` pattern, with required ketone/glucose columns, a stored computed `gki`,
the `(user_id, day)` upsert target, and CHECK guards (positivity + ranges).

**Contract**: Table `public.biomarker_readings` with:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users (id) on delete cascade`
- `day date not null` — the client-reported local calendar date the reading counts toward
- `ketones_mmol_l numeric not null`, `check (ketones_mmol_l > 0 and ketones_mmol_l <= 20)` — strictly
  positive lower bound is the GKI div-by-zero guard
- `glucose_mg_dl numeric not null`, `check (glucose_mg_dl between 20 and 600)`
- `gki numeric not null` — computed server-side `(glucose_mg_dl / 18) / ketones_mmol_l`; stored, not
  user-entered. (No CHECK needed beyond the inputs', but it is non-null because both inputs are.)
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
- `unique (user_id, day)` — enforces one reading per user per day (the upsert conflict target)
- `enable row level security` + four policies (`biomarker_readings_select_own`, `_insert_own`,
  `_update_own`, `_delete_own`), each `to authenticated`, keyed on `auth.uid() = user_id` (writes
  with `with check`), copied verbatim from the canary/meals migration.
- An index on `(user_id, day)` is already provided by the `unique (user_id, day)` constraint — no
  separate index needed (it doubles as the daily lookup index, unlike `meals` which needed an
  explicit one for its non-unique `(user_id, day)`).

#### 2. Biomarker-readings RLS isolation proof

**File**: `supabase/tests/biomarker_readings_rls.sql`

**Intent**: Re-runnable cross-user proof that one user cannot see another's readings — a copy of
`supabase/tests/meals_rls.sql` swapped to `biomarker_readings`.

**Contract**: Same four-block structure (seed user A's reading, seed user B's reading, impersonate B
and assert it sees only its own row, unrestricted sanity check showing both). Insert valid rows with
all not-null columns filled — `day = current_date`, distinct `ketones_mmol_l`/`glucose_mg_dl`, and a
`gki` consistent with the formula (e.g. A: ketones 1.0, glucose 90 → gki 5.0; B: ketones 2.0, glucose
108 → gki 3.0). Because `(user_id, day)` is unique, each user seeds exactly one row for
`current_date`; the proof asserts B's visible rows exclude A's.

#### 3. Shared types

**File**: `src/types.ts` (append)

**Intent**: Home for the biomarker entity + the create/upsert command, per AGENTS.md.

**Contract**: Export `BiomarkerReading` (row shape: `id`, `user_id`, `day`, `ketones_mmol_l`,
`glucose_mg_dl`, `gki`, `created_at`, `updated_at` — field names mirror the DB columns, like the meals
types) and `UpsertBiomarkerReadingCommand` (the validated request body: `day`, `ketones_mmol_l`,
`glucose_mg_dl` — **no `gki`**, since the server computes it). All numeric fields are `number`
(non-null — both inputs required).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly locally: `npx supabase db reset` runs without error
- Table + 4 policies exist: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -c "select polname from pg_policy pol join pg_class c on c.oid=pol.polrelid where c.relname='biomarker_readings';"` returns 4 rows
- `unique (user_id, day)` exists: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -c "\d public.biomarker_readings"` shows a unique constraint/index on `(user_id, day)`
- Typecheck/lint pass: `npx astro sync && npm run lint`

#### Manual Verification:

- `biomarker_readings_rls.sql` run against the local db container shows the proof passing — user B sees only its own row
- A direct insert of `ketones_mmol_l = 0` is rejected by the CHECK (spot-check in Studio/psql), confirming the div-by-zero guard
- `src/types.ts` biomarker types match the migration columns (spot-check)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: GKI compute helper + reading service + JSON API route

### Overview

Add a pure `computeGki()` helper and a biomarker service (read today's reading, upsert with the
computed GKI, delete the day's reading), then a Zod-validated JSON API at
`src/pages/api/biomarkers/index.ts` with `GET` (today's reading), `POST` (upsert), and `DELETE` (clear).

### Changes Required:

#### 1. GKI compute helper + biomarker service

**File**: `src/lib/services/biomarkers.ts` (new)

**Intent**: One place that computes GKI and reads/writes the user's per-day reading, reused by the API
route (and later by S-06/S-09 for the formula).

**Contract**:
- `computeGki(glucoseMgDl: number, ketonesMmolL: number): number` — pure: `(glucoseMgDl / 18) /
  ketonesMmolL`. Assumes `ketonesMmolL > 0` (the precondition is enforced upstream by Zod/DB). No
  rounding (caller/display rounds).
- `getReading(supabase, day): Promise<BiomarkerReading | null>` — selects the single row for `day`
  (RLS scopes to the user) via `.eq("day", day).maybeSingle<BiomarkerReading>()`, returns it or
  `null` (mirror `getProfile`'s `maybeSingle` no-row handling).
- `upsertReading(supabase, userId, data: UpsertBiomarkerReadingCommand): Promise<BiomarkerReading>` —
  compute `gki = computeGki(data.glucose_mg_dl, data.ketones_mmol_l)`, then
  `.upsert({ user_id, day, ketones_mmol_l, glucose_mg_dl, gki, updated_at: now }, { onConflict: "user_id,day" }).select().single()`.
  Build the payload with all columns explicitly (mirror `upsertProfile` — do not spread a partial).
- `deleteReading(supabase, day): Promise<boolean>` — `.delete().eq("day", day).select().single()`;
  RLS scopes to the caller's own row. Return whether a row was deleted (for the route's 404-vs-200).

#### 2. Biomarkers API route

**File**: `src/pages/api/biomarkers/index.ts` (new)

**Intent**: `GET` today's reading, `POST` an upsert (server computes GKI), `DELETE` the day's reading
— all JSON, mirroring the meals route's auth/validation/error shape.

**Contract**:
- `export const prerender = false;`
- Reuse a `daySchema` identical to `src/pages/api/meals/index.ts` (regex `^\d{4}-\d{2}-\d{2}$` +
  real-date `refine`) for the `?day=` query param and the body's `day`.
- Body schema `upsertBiomarkerSchema = z.object({ day: daySchema, ketones_mmol_l: z.number().min(0.1).max(20),
  glucose_mg_dl: z.number().int().min(20).max(600) })`. The `min(0.1)` mirrors the DB `> 0` guard
  (kept just above zero) so GKI never divides by zero; bounds mirror the CHECK constraints.
- All three handlers: 401 when `context.locals.user` is absent; 500 when `createClient(...)` returns
  null (Supabase unconfigured) — same guards as the meals route.
- `GET /api/biomarkers?day=YYYY-MM-DD` → validate `day`; return `{ reading }` where `reading` is the
  row or `null`. 400 on an invalid day.
- `POST /api/biomarkers` → parse JSON body (400 on bad JSON), validate with `upsertBiomarkerSchema`
  (400 + `z.flattenError(...).fieldErrors` on failure), `upsertReading(...)` with `user_id` from
  `context.locals.user.id`, return `{ reading }` with `201`.
- `DELETE /api/biomarkers?day=YYYY-MM-DD` → validate `day`; `deleteReading(...)`; return `200` (e.g.
  `{ ok: true }`) when a row was removed, `404` when none existed for that day.

**Note**: `gki` is never in the request schema — it is computed in `upsertReading`. The Zod numeric
bounds and the DB CHECK constraints are the two enforcement layers; keep them in sync (0.1–20
ketones, 20–600 glucose).

### Success Criteria:

#### Automated Verification:

- Typecheck/lint pass: `npx astro sync && npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `POST /api/biomarkers` (curl or the Phase 3 island) with `{day, ketones_mmol_l:1.5, glucose_mg_dl:90}` returns a reading with `gki ≈ 3.33` and `201`; row visible in Studio
- A second POST for the **same day** with different values updates the **same** row (no duplicate) — one row per (user, day) in Studio
- `GET /api/biomarkers?day=` returns the day's reading, or `{ reading: null }` when none exists
- `POST` with `ketones_mmol_l:0` (or `-1`, or out-of-range glucose) returns `400` and persists nothing
- `POST` with a missing field returns `400`
- `DELETE /api/biomarkers?day=` removes the row and returns `200`; a second DELETE for the same day returns `404`
- Unauthenticated `GET`/`POST`/`DELETE` are rejected with `401`

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: UI — BiomarkerLogger dashboard island

### Overview

Add a `BiomarkerLogger` React island (meals-style: fetch today's reading on mount, submit
ketones+glucose, show the computed GKI in place, delete/clear) and mount it on `/dashboard` alongside
`MealLogger`.

### Changes Required:

#### 1. BiomarkerLogger island

**File**: `src/components/biomarkers/BiomarkerLogger.tsx` (new)

**Intent**: Client island mirroring `MealLogger` — computes the local day, fetches today's reading on
mount, posts ketones+glucose, renders the returned GKI in place, and offers a delete/clear action.

**Contract**:
- Compute the browser's local date with a `localDay()` helper identical to
  `MealLogger.tsx:11` (consider extracting it to `@/lib/utils` if trivially shared — otherwise
  duplicate the four lines, matching the existing pattern).
- On mount: `fetch("/api/biomarkers?day=" + day)`; populate the form/readout from `{ reading }` (or
  show the empty form when `null`). Use an `AbortController` cleanup like `MealLogger`.
- Two numeric inputs: ketones (mmol/L, `step="0.1"`) and glucose (mg/dL, integer). A submit button.
  On submit: `POST` JSON `{ day, ketones_mmol_l, glucose_mg_dl }` (numbers, not strings); on success
  set the reading state so the **GKI displays in place** (rounded to 1 decimal); on a non-OK response
  surface `data.error` inline (mirror `MealLogger.submit`'s error handling).
- Client-side guard before POST: block submit when either field is empty or ketones ≤ 0 / out of the
  0.1–20 (ketones) / 20–600 (glucose) bounds — inline error, no request (the server stays the source
  of truth; this just avoids a known-bad round-trip, mirroring `MealLogger`'s `text` guard).
- A delete/clear control (shown only when a reading exists): `DELETE /api/biomarkers?day=` then reset
  to the empty state. Use a lucide `Trash2` icon like `MealLogger`'s delete.
- Display: when a reading exists, show ketones, glucose, and **GKI** (1-decimal) — a compact readout
  styled like `DailyTotal`'s metric cards (reuse the card classes; a tiny presentational subcomponent
  is fine but optional). Use `cn()` from `@/lib/utils`, the `Button` primitive, lucide icons, and the
  existing dashboard styling (`bg-white/5`, `border-white/10`, etc.).

#### 2. Mount on the dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Render the biomarker island alongside the meal logger.

**Contract**: Import `BiomarkerLogger` and mount `<BiomarkerLogger client:load />` inside the existing
card container (below `<MealLogger client:load />`), separated by the existing spacing/section pattern.
A small heading ("Biomarkers") consistent with the meal logger's section headers. No other dashboard
change; no middleware change (`/dashboard` already protected).

### Success Criteria:

#### Automated Verification:

- Typecheck/lint pass: `npx astro sync && npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Logged-in user on `/dashboard` sees an empty Biomarkers section on a day with no reading
- Entering ketones `1.5` + glucose `90` and saving shows `GKI 3.3` in place without a full reload; row visible in Studio
- Re-saving with different values updates the readout and keeps a single row for the day (no duplicate)
- The delete/clear action removes the reading and returns the section to its empty state
- Entering ketones `0` (or out-of-range values, or leaving a field blank) shows an inline error and persists nothing
- Reloading `/dashboard` re-fetches and shows today's saved reading (and its GKI)
- Visiting `/dashboard` while logged out redirects to `/auth/signin`; a second user sees an empty biomarker section (no cross-user leakage); no regressions to the meal logger, profile, or sign-in/out

**Implementation Note**: Final phase — confirm the full log → see-GKI → re-log → delete loop manually before closing the change.

---

## Testing Strategy

### Unit Tests:

- None added (no framework in the repo, by decision). `computeGki` correctness, validation, and the
  per-day upsert are verified manually and via the SQL RLS recipe. (`computeGki` is written as a pure
  function so a runner could be added later without refactoring.)

### Integration Tests:

- Manual end-to-end against the local Supabase stack.

### Manual Testing Steps:

1. `npx supabase start` (or confirm running), `npm run dev`, sign in.
2. On `/dashboard`, the Biomarkers section is empty for today.
3. Enter ketones `1.5`, glucose `90` → save → `GKI 3.3` shows in place; confirm one row in Studio.
4. Change to ketones `1.0`, glucose `108` → save → `GKI 6.0`; still a single row for the day.
5. Enter ketones `0` → save → inline error, nothing persisted.
6. Leave glucose blank → save → inline error, nothing persisted.
7. Click delete/clear → section returns to empty; row gone from Studio.
8. Reload `/dashboard` → today's reading (if present) re-appears with its GKI.
9. Run `supabase/tests/biomarker_readings_rls.sql` via the db container → proof passes, B sees only its own.
10. Sign in as a second user → empty biomarker section; meals / profile / sign-out still work.

## Performance Considerations

- Single-row read, upsert, and delete per user per day; the `unique (user_id, day)` constraint doubles
  as the lookup index. No load concern at MVP single-user scale.

## Migration Notes

- Forward-only (AGENTS.md). The `biomarker_readings` migration applies locally via `db reset` during
  dev and reaches cloud via `npx supabase db push` on merge to `master`. No existing data to migrate.
  Widening a range later (e.g. the ketone ceiling) is a new `alter ... drop/add constraint` migration.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-03)
- PRD: FR-006, US-01, Business Logic rule 1 (GKI formula) — `context/foundation/prd.md`
- Change identity + locked decisions: `context/changes/biomarker-gki-logging/change.md`
- Time-series slice to mirror (table + JSON API + island): `context/changes/meal-macro-logging/plan.md`,
  `supabase/migrations/20260615182411_meals.sql`, `src/pages/api/meals/index.ts`,
  `src/components/meals/MealLogger.tsx`
- Singleton-upsert precedent: `src/lib/services/profile.ts:29`, `supabase/migrations/20260617072330_health_profiles.sql`
- RLS pattern + proof to copy: `supabase/migrations/20260609151323_isolation_canary.sql`, `supabase/tests/meals_rls.sql`
- SSR client: `src/lib/supabase.ts`; route protection (unchanged): `src/middleware.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundations — migration, RLS proof, types

#### Automated

- [ ] 1.1 Migration applies cleanly locally: `npx supabase db reset` runs without error
- [ ] 1.2 Table + 4 policies exist (psql pg_policy query returns 4 rows)
- [ ] 1.3 `unique (user_id, day)` constraint exists (`\d public.biomarker_readings`)
- [x] 1.4 Typecheck/lint pass: `npx astro sync && npm run lint` — 0f3c12d

#### Manual

- [ ] 1.5 `biomarker_readings_rls.sql` proof passes; user B sees only its own row
- [ ] 1.6 Direct insert of `ketones_mmol_l = 0` rejected by CHECK (div-by-zero guard)
- [ ] 1.7 `src/types.ts` biomarker types match the migration columns

### Phase 2: GKI compute helper + reading service + JSON API route

#### Automated

- [x] 2.1 Typecheck/lint pass: `npx astro sync && npm run lint` — d6390e5
- [x] 2.2 Build succeeds: `npm run build` — d6390e5

#### Manual

- [ ] 2.3 Valid POST returns a reading with the correct `gki` and `201`; row visible in Studio
- [ ] 2.4 Second POST for the same day updates the same row (no duplicate)
- [ ] 2.5 GET returns the day's reading, or `{ reading: null }` when none exists
- [ ] 2.6 POST with `ketones_mmol_l:0` / out-of-range / missing field returns `400`, persists nothing
- [ ] 2.7 DELETE removes the row (`200`); second DELETE for the same day returns `404`
- [ ] 2.8 Unauthenticated GET/POST/DELETE rejected with `401`

### Phase 3: UI — BiomarkerLogger dashboard island

#### Automated

- [x] 3.1 Typecheck/lint pass: `npx astro sync && npm run lint`
- [x] 3.2 Build succeeds: `npm run build`

#### Manual

- [ ] 3.3 Empty Biomarkers section on a day with no reading
- [ ] 3.4 Save ketones+glucose → GKI shows in place without a full reload; row in Studio
- [ ] 3.5 Re-save updates the readout, keeps a single row for the day
- [ ] 3.6 Delete/clear removes the reading, returns to empty state
- [ ] 3.7 Invalid input (ketones 0 / out-of-range / blank) shows inline error, persists nothing
- [ ] 3.8 Reloading `/dashboard` re-fetches and shows today's saved reading + GKI
- [ ] 3.9 Logged-out `/dashboard` redirects to signin; second user sees empty section; no regressions
