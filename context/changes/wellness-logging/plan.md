# Daily Wellness Parameters Logging (S-05) Implementation Plan

## Overview

Let a logged-in user record their daily wellness parameters — mood, energy level, and sleep
quality (each a subjective **1–10 integer rating**), water intake (**liters**), and a **freeform
notes** field — and immediately see today's saved entry. The entry is a **singleton per (user,
day)**: re-logging the same day upserts the row, exactly like `biomarker_readings` (S-03). Unlike
biomarkers, **every field is optional** (health-profile precedent): the user may save just mood, or
just notes; a cleared field is stored as explicit `null`. A fully-empty submit is rejected so no
meaningless empty rows accumulate. There is **no AI call and no computed field** — this is the
simplest slice, a pure form on a thrice-proven template. It is surfaced as a React island on
`/dashboard` next to the existing loggers, with in-place feedback and a clear action, all protected
by the same per-user RLS pattern every other table follows. The freeform notes field is the context
S-09's on-demand AI analysis can later reference.

## Current State Analysis

- **The slice template is proven four times over.** The closest analog is S-03
  `biomarker-gki-logging`, a **singleton per (user, day)**: an RLS table with a `day date` column +
  a `unique (user_id, day)` constraint (`supabase/migrations/20260630120001_biomarker_readings.sql`),
  a service with `getReading`/`upsertReading`/`deleteReading` upserting on `{ onConflict: "user_id,day" }`
  (`src/lib/services/biomarkers.ts`), a Zod-validated JSON API with `GET`/`POST`/`DELETE`
  (`src/pages/api/biomarkers/index.ts`), and a `client:load` fetch island
  (`src/components/biomarkers/BiomarkerLogger.tsx`) mounted on `/dashboard`. S-05 copies this shape
  almost verbatim.
- **The all-nullable partial-save precedent is S-02 `health-profile`.** `upsertProfile`
  (`src/lib/services/profile.ts`) builds the payload with every column listed explicitly and sends
  explicit `null` (never `undefined`, which PostgREST would skip) so a cleared field NULLs that
  column on the conflict-UPDATE path. `UpdateHealthProfileCommand` (`src/types.ts:73`) makes every
  field `T | null`. S-05 blends this nullability with biomarker's per-day cardinality.
- **Auth + SSR + RLS are wired.** `src/middleware.ts` guards `PROTECTED_ROUTES`
  (`["/dashboard","/profile"]`) and attaches `context.locals.user`. `/dashboard` is already protected
  — **no middleware change is needed**. `src/lib/supabase.ts` is the only client factory; it scopes
  every query to the logged-in user via RLS and returns `null` when env is unset.
- **The biomarker route is the precedent to mirror for the route shape:** `daySchema` (regex +
  real-date `refine`), `GET /api/biomarkers?day=` returns `{ reading }` or `null`, `POST` validates
  the body with Zod and sets nothing about ownership in the body (RLS `with check` uses
  `context.locals.user.id`), `DELETE /api/biomarkers?day=` clears the day's singleton. Errors are
  JSON `{ error }` with appropriate status codes; 401 unauthenticated, 500 when Supabase is unset.
- **`src/types.ts` is the home for shared types** (AGENTS.md). It already holds the meals, profile,
  biomarker, and activity DTOs; this slice appends the wellness entity + command.
- **RLS table + proof pattern to copy:** `supabase/migrations/20260609151323_isolation_canary.sql`
  (table + `user_id → auth.users on delete cascade` + `enable RLS` + four granular `to authenticated`
  policies keyed on `auth.uid() = user_id`) and the re-runnable proof
  `supabase/tests/biomarker_readings_rls.sql`.
- **Local Supabase runs in Docker** (db container `supabase_db_10x-astro-starter`, Studio
  `http://127.0.0.1:54323`); migrations auto-apply on `supabase start`, iterate with
  `npx supabase db reset`. `.env`/`.dev.vars` point at local. Latest existing migration timestamp is
  `20260630120001` — the new file must sort after it.
- **No test framework** in the repo — CI runs lint + build only. Verification matches that reality
  (lint, `astro sync` typecheck, build, plus the SQL RLS recipe + manual UI walkthrough).

## Desired End State

A logged-in user on `/dashboard` sees a "Wellness" section (a fourth island below meals, activity,
and biomarkers). On load it shows today's entry if one exists (mood, energy, sleep quality, water,
notes), or an empty form. They fill in whichever fields they want — e.g. mood `7`, sleep `5`, and a
note — leaving the rest blank, and save; the saved values appear in place without a full page reload.
Saving again with different values **overwrites** today's entry (still one row for the day). Blanking
a field and re-saving clears that column (stored `null`). A clear/delete action removes the day's
entry and returns the section to its empty state. A rating outside 1–10, a negative or implausible
water value, or a **fully-empty** submit is rejected — nothing is saved and the user sees an inline
error. A second signed-in user never sees the first user's entries (proven by the copied RLS SQL
recipe). Visiting `/dashboard` while logged out redirects to `/auth/signin` (unchanged).

**Verification of end state:** `npm run lint`, `astro sync` typecheck, and `npm run build` all pass;
the `wellness_entries` RLS isolation recipe passes locally against two users; manual walkthrough of
log → see-entry → partial-edit → re-log-overwrites → clear-a-field → delete → reject-invalid →
reject-empty all behave as described.

### Key Discoveries:

- **Schema = biomarker's `day` singleton + profile's nullable fields.** Copy the table + four
  policies + `unique (user_id, day)` from `biomarker_readings`, but make every wellness field
  **nullable** (no `not null`) like `health_profiles`, with range CHECKs that tolerate NULL.
- **No computed column, no AI service.** Unlike biomarker (stored `gki`) and activity (LLM estimate),
  every column is user-supplied. The service is a plain read / upsert / delete — no `compute*` helper,
  no OpenRouter module.
- **Explicit-null upsert, every column listed.** Mirror `upsertProfile` (`src/lib/services/profile.ts`):
  build the payload with all columns present (`user_id`, `day`, `mood`, `energy`, `sleep_quality`,
  `water_liters`, `notes`, `updated_at`) so a blanked field is sent as `null` and NULLs the column on
  the UPDATE path. `updated_at` is set explicitly because the column default fires only on insert.
- **The fully-empty guard lives at the schema layer.** The POST body Zod schema requires `day` plus a
  `.refine` that at least one of the five fields is non-null; an all-empty body is a 400. The island
  applies the same guard client-side before the round-trip (mirrors `BiomarkerLogger`'s empty guard).
- **DELETE is day-keyed**, like biomarker's: `DELETE /api/wellness?day=YYYY-MM-DD`; RLS scopes the
  delete to the caller's own row, so a stray day affects zero rows → 404.
- **No middleware change** — `/dashboard` is already in `PROTECTED_ROUTES`.
- **The island fetches `?day=` with the browser's local date**, via a `localDay()` helper identical
  to `BiomarkerLogger.tsx:12` (duplicated by design per the comment there — do NOT extract to utils).

## What We're NOT Doing

- **No structured biometeorological field** — the roadmap narrowed FR-007 to the five fields; weather
  / biometeo prose goes in the freeform `notes`, not its own column.
- **No AI call** — every field is user-entered; there is no estimator and no `OPENROUTER_API_KEY` use.
- **No computed/derived field** — unlike biomarker's stored GKI; nothing is calculated server-side.
- **No multiple entries per day** — one singleton row per (user, day); re-logging overwrites.
- **No required fields** — every field is optional (partial save); only a *fully-empty* submit is
  rejected.
- **No trend charts / history view** — this slice only logs and shows *today's* entry. Charting is
  S-06/S-07; past-day read-back is S-08.
- **No edit-of-a-past-day** — only today's entry is logged/edited via the dashboard. (Re-log = edit
  of today.)
- **No new page or nav** — the UI is a dashboard island; no `/wellness` route, no middleware change.
- **No new test framework** — verification matches current CI (lint + build) plus the SQL RLS recipe.
- **No changes to the meals, profile, biomarker, or activity slices** or the auth routes.

## Implementation Approach

Bottom-up, mirroring S-03 so each layer is verifiable before the next depends on it: (1) data + types
foundation (migration with the `(user_id, day)` singleton + nullable fields + range CHECKs, RLS proof,
shared types); (2) the wellness service (read / explicit-null upsert / delete) + the Zod-validated
JSON API (`GET`/`POST`/`DELETE`) with the at-least-one-field guard; (3) the `WellnessLogger` dashboard
island and its wiring into `/dashboard`. Each phase is independently committed.

## Critical Implementation Details

- **Explicit-null upsert, never a partial spread.** Like `upsertProfile`, build the payload object
  with all columns present (`user_id`, `day`, `mood`, `energy`, `sleep_quality`, `water_liters`,
  `notes`, `updated_at`). A field the user left blank must be sent as `null`, not omitted — PostgREST
  skips `undefined`, which would silently preserve a stale value on the UPDATE path instead of
  clearing it. `user_id` is set from `context.locals.user.id` to satisfy the RLS `with check`.
- **At-least-one-field is enforced at the Zod layer, not the DB.** The POST schema's `.refine`
  rejects an all-null body (400). Do not add a table-level CHECK for this — it would also block the
  legitimate "clear everything" path; clearing the whole day is the DELETE route, not an empty upsert.
- **`day` is the client's local calendar date**, supplied by the island (not derived from UTC
  `now()`), so the entry groups under the correct day across timezones — identical to the biomarker
  `day` contract.

## Phase 1: Foundations — migration, RLS proof, types

### Overview

Create the singleton-per-day `wellness_entries` table with the proven RLS pattern, all-nullable
wellness fields, and range CHECKs that tolerate NULL; copy the isolation proof for it; and declare
the shared wellness types.

### Changes Required:

#### 1. Wellness-entries migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_wellness_entries.sql` (timestamp at authoring time, per AGENTS.md filename rule; must sort after the latest existing migration `20260630120001`)

**Intent**: Create the per-(user, day) singleton `wellness_entries` table following the
`isolation_canary` + `biomarker_readings` pattern, with five all-nullable wellness fields, the
`(user_id, day)` upsert target, and range CHECKs that allow NULL.

**Contract**: Table `public.wellness_entries` with:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users (id) on delete cascade`
- `day date not null` — the client-reported local calendar date the entry counts toward
- `mood integer`, `check (mood between 1 and 10)` — nullable subjective rating
- `energy integer`, `check (energy between 1 and 10)` — nullable subjective rating
- `sleep_quality integer`, `check (sleep_quality between 1 and 10)` — nullable subjective rating
- `water_liters numeric`, `check (water_liters >= 0 and water_liters <= 20)` — nullable, liters
- `notes text`, `check (char_length(notes) <= 2000)` — nullable freeform field, bounded length
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
- `unique (user_id, day)` — enforces one entry per user per day (the upsert conflict target; also
  backs the per-user daily lookup, so no separate index is needed)
- `enable row level security` + four policies (`wellness_entries_select_own`, `_insert_own`,
  `_update_own`, `_delete_own`), each `to authenticated`, keyed on `auth.uid() = user_id` (writes
  with `with check`), copied verbatim from the biomarker/canary migration.

**Contract note**: Range CHECKs on a nullable column pass automatically when the value is NULL
(SQL CHECK is satisfied unless it evaluates to false), so the all-optional contract holds without
special handling. There is intentionally **no** table CHECK requiring at-least-one-field — that
guard lives in the route's Zod schema (see Phase 2), because clearing the whole day is the DELETE
path, not an empty upsert.

#### 2. Wellness-entries RLS isolation proof

**File**: `supabase/tests/wellness_entries_rls.sql`

**Intent**: Re-runnable cross-user proof that one user cannot see another's entries — a copy of
`supabase/tests/biomarker_readings_rls.sql` swapped to `wellness_entries`.

**Contract**: Same four-block structure (seed user A's entry, seed user B's entry, impersonate B and
assert it sees only its own row, unrestricted sanity check showing both). Insert valid rows with
`day = current_date` and a representative mix of filled + NULL fields (e.g. A: mood 8, energy 7,
sleep 6, water 2.5, notes 'good day'; B: mood 4, others NULL) — exercising both filled and nullable
columns. Because `(user_id, day)` is unique, each user seeds exactly one row for `current_date`; the
proof asserts B's visible rows exclude A's.

#### 3. Shared types

**File**: `src/types.ts` (append)

**Intent**: Home for the wellness entity + the upsert command, per AGENTS.md.

**Contract**: Export `WellnessEntry` (row shape: `id`, `user_id`, `day`, `mood`, `energy`,
`sleep_quality`, `water_liters`, `notes`, `created_at`, `updated_at` — field names mirror the DB
columns; the four wellness values and notes are `number | null` / `string | null`) and
`UpsertWellnessEntryCommand` (the validated request body: `day: string` plus `mood`, `energy`,
`sleep_quality`, `water_liters` as `number | null` and `notes` as `string | null`). Mirror the
`HealthProfile` / `UpdateHealthProfileCommand` nullability convention (`src/types.ts:54`).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly locally: `npx supabase db reset` runs without error
- Table + 4 policies exist: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -c "select polname from pg_policy pol join pg_class c on c.oid=pol.polrelid where c.relname='wellness_entries';"` returns 4 rows
- `unique (user_id, day)` exists: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -c "\d public.wellness_entries"` shows a unique constraint/index on `(user_id, day)`
- Typecheck/lint pass: `npx astro sync && npm run lint`

#### Manual Verification:

- `wellness_entries_rls.sql` run against the local db container shows the proof passing — user B sees only its own row
- A direct insert of `mood = 11` (or `water_liters = -1`) is rejected by the CHECK (spot-check in Studio/psql); an insert with all five fields NULL is *accepted* (the optionality contract)
- `src/types.ts` wellness types match the migration columns (spot-check)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Wellness service + JSON API route

### Overview

Add a wellness service (read today's entry, explicit-null upsert, delete the day's entry), then a
Zod-validated JSON API at `src/pages/api/wellness/index.ts` with `GET` (today's entry), `POST`
(upsert, with the at-least-one-field guard), and `DELETE` (clear).

### Changes Required:

#### 1. Wellness service

**File**: `src/lib/services/wellness.ts` (new)

**Intent**: One place that reads / writes / deletes the user's per-day wellness entry, reused by the
API route (and later by S-08/S-09).

**Contract**:
- `getEntry(supabase, day): Promise<WellnessEntry | null>` — selects the single row for `day` (RLS
  scopes to the user) via `.eq("day", day).maybeSingle<WellnessEntry>()`, returns it or `null`
  (mirror `getReading` / `getProfile`'s `maybeSingle` no-row handling).
- `upsertEntry(supabase, userId, data: UpsertWellnessEntryCommand): Promise<WellnessEntry>` —
  `.upsert({ user_id, day, mood, energy, sleep_quality, water_liters, notes, updated_at: now },
  { onConflict: "user_id,day" }).select().single()`. Build the payload with all columns explicitly
  (mirror `upsertProfile` — do not spread a partial); blanked fields arrive as `null` from the route
  and NULL the column on the UPDATE path.
- `deleteEntry(supabase, day): Promise<boolean>` — `.delete().eq("day", day).select().maybeSingle()`;
  RLS scopes to the caller's own row. Return whether a row was deleted (for the route's 404-vs-200),
  exactly like `deleteReading`.

#### 2. Wellness API route

**File**: `src/pages/api/wellness/index.ts` (new)

**Intent**: `GET` today's entry, `POST` an upsert (all-optional fields, at-least-one required),
`DELETE` the day's entry — all JSON, mirroring the biomarker route's auth/validation/error shape.

**Contract**:
- `export const prerender = false;`
- Reuse a `daySchema` identical to `src/pages/api/biomarkers/index.ts` (regex `^\d{4}-\d{2}-\d{2}$` +
  real-date `refine`) for the `?day=` query param and the body's `day`.
- Body schema: each wellness field is `.nullable()` and (where appropriate) `.optional()` coalesced to
  `null`; ratings `z.number().int().min(1).max(10).nullable()`, water
  `z.number().min(0).max(20).nullable()`, notes `z.string().trim().max(2000).nullable()` (an empty
  string trims to and is normalized to `null`). A top-level `.refine` requires **at least one** of the
  five fields to be non-null — an all-null body fails validation (400). The bounds mirror the DB CHECK
  constraints (ratings 1–10, water 0–20, notes ≤ 2000); keep them in sync.
- All three handlers: 401 when `context.locals.user` is absent; 500 when `createClient(...)` returns
  null (Supabase unconfigured) — same guards as the biomarker route.
- `GET /api/wellness?day=YYYY-MM-DD` → validate `day`; return `{ entry }` where `entry` is the row or
  `null`. 400 on an invalid day.
- `POST /api/wellness` → parse JSON body (400 on bad JSON), validate (400 +
  `z.flattenError(...).fieldErrors` on failure, including the all-empty case),
  `upsertEntry(...)` with `user_id` from `context.locals.user.id`, return `{ entry }` with `201`.
- `DELETE /api/wellness?day=YYYY-MM-DD` → validate `day`; `deleteEntry(...)`; return `200`
  (`{ ok: true }`) when a row was removed, `404` when none existed for that day.

**Note**: There is no computed field and no AI path — the POST never returns 422. The two enforcement
layers are the Zod schema (bounds + at-least-one) and the DB CHECKs; keep them in sync.

### Success Criteria:

#### Automated Verification:

- Typecheck/lint pass: `npx astro sync && npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `POST /api/wellness` (curl or the Phase 3 island) with `{day, mood:7, notes:"ok"}` and the other
  fields omitted returns an entry with those values set and the rest `null`, status `201`; row visible
  in Studio
- A second POST for the **same day** with different values updates the **same** row (no duplicate) —
  one row per (user, day) in Studio; a field sent as `null` is cleared on the row
- `GET /api/wellness?day=` returns the day's entry, or `{ entry: null }` when none exists
- `POST` with `mood:11` (or `water_liters:-1`, or `notes` over 2000 chars) returns `400` and persists
  nothing
- `POST` with **all five fields null/absent** returns `400` (the at-least-one guard) and persists nothing
- `DELETE /api/wellness?day=` removes the row and returns `200`; a second DELETE for the same day
  returns `404`
- Unauthenticated `GET`/`POST`/`DELETE` are rejected with `401`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: UI — WellnessLogger dashboard island

### Overview

Add a `WellnessLogger` React island (biomarker-style: fetch today's entry on mount, submit any
subset of the five fields, show the saved values in place, clear action) and mount it as the fourth
island on `/dashboard`.

### Changes Required:

#### 1. WellnessLogger island

**File**: `src/components/wellness/WellnessLogger.tsx` (new)

**Intent**: Client island mirroring `BiomarkerLogger` — computes the local day, fetches today's entry
on mount, posts whichever fields are filled, renders the saved entry in place, and offers a
clear/delete action.

**Contract**:
- Compute the browser's local date with a `localDay()` helper identical to `BiomarkerLogger.tsx:12`
  (duplicate the helper, matching the existing cross-branch convention — the comment there says do NOT
  extract to `@/lib/utils`).
- On mount: `fetch("/api/wellness?day=" + day)`; populate the form/readout from `{ entry }` (or show
  the empty form when `null`). Use an `AbortController` cleanup like `BiomarkerLogger`.
- Inputs: three numeric inputs for mood / energy / sleep quality (`type="number"`, `step="1"`,
  `min={1}`, `max={10}`), one numeric input for water (`step="0.1"`, `min={0}`), and a `textarea` for
  notes. Each field may be left blank. A submit button (label "Save" / "Update" depending on whether
  an entry exists), and a clear control shown only when an entry exists.
- Convert each field to its payload value on submit: a blank input → `null`, otherwise the parsed
  number (ratings/water) or trimmed string (notes). POST JSON `{ day, mood, energy, sleep_quality,
  water_liters, notes }`.
- Client-side guards before POST (server stays the source of truth; these avoid known-bad round-trips,
  mirroring `BiomarkerLogger`'s guards): block submit when **all five fields are blank** (inline "Wypełnij
  przynajmniej jedno pole." message); block a rating outside 1–10 or water outside 0–20 with an inline
  range message. On success, set the entry state so the saved values display in place; on a non-OK
  response surface `data.error` inline.
- A clear/delete control: `DELETE /api/wellness?day=` then reset to the empty state. Use a lucide
  `Trash2` icon like `BiomarkerLogger`'s clear.
- Display & styling: reuse `BiomarkerLogger`'s structure and classes — `cn()` from `@/lib/utils`, the
  `Button` primitive, lucide icons, and the existing dashboard styling (`bg-white/5`,
  `border-white/10`, focus ring, etc.). A compact readout of the saved values (mirroring the `Metric`
  card pattern for the three ratings + water; notes shown as text) is fine but optional.

#### 2. Mount on the dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Render the wellness island as the fourth logging island.

**Contract**: Import `WellnessLogger` and mount `<WellnessLogger client:load />` inside the existing
card container, below the biomarker island, separated by the existing divider/spacing pattern
(`border-t border-white/10`, `mt-8 pt-6`) with a small "Wellness" section heading consistent with the
"Activity" / "Biomarkers" headings. No other dashboard change; no middleware change (`/dashboard`
already protected).

### Success Criteria:

#### Automated Verification:

- Typecheck/lint pass: `npx astro sync && npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Logged-in user on `/dashboard` sees an empty Wellness section on a day with no entry
- Filling only mood `7` and a note, leaving the rest blank, and saving shows those values in place
  without a full reload; row visible in Studio with the other columns `null`
- Re-saving with more fields filled (and one previously-set field blanked) updates the readout, keeps
  a single row for the day, and clears the blanked column to `null`
- The clear/delete action removes the entry and returns the section to its empty state
- Entering a rating outside 1–10 (or negative water), or submitting with every field blank, shows an
  inline error and persists nothing
- Reloading `/dashboard` re-fetches and shows today's saved entry
- Visiting `/dashboard` while logged out redirects to `/auth/signin`; a second user sees an empty
  wellness section (no cross-user leakage); no regressions to the meal / activity / biomarker islands,
  profile, or sign-in/out

**Implementation Note**: Final phase — confirm the full log → see-entry → partial-edit → clear-a-field → delete loop manually before closing the change.

---

## Testing Strategy

### Unit Tests:

- None added (no framework in the repo, by decision). Validation (bounds + at-least-one) and the
  per-day upsert are verified manually and via the SQL RLS recipe. The service functions are written
  small/isolated so a runner could be added later without refactoring.

### Integration Tests:

- Manual end-to-end against the local Supabase stack.

### Manual Testing Steps:

1. `npx supabase start` (or confirm running), `npm run dev`, sign in.
2. On `/dashboard`, the Wellness section is empty for today.
3. Fill mood `7`, leave the rest blank, add a note → save → values show in place; confirm one row in
   Studio with other columns `null`.
4. Edit: set energy `5`, sleep `6`, water `2.5`, blank the note → save → readout updates; still a
   single row; `notes` is now `null`.
5. Enter mood `11` → save → inline range error, nothing persisted.
6. Blank every field → save → inline "fill at least one field" error, nothing persisted.
7. Click clear/delete → section returns to empty; row gone from Studio.
8. Reload `/dashboard` → today's entry (if present) re-appears.
9. Run `supabase/tests/wellness_entries_rls.sql` via the db container → proof passes, B sees only its own.
10. Sign in as a second user → empty Wellness section; meals / activity / biomarkers / profile /
    sign-out still work.

## Performance Considerations

- Single-row read, upsert, and delete per user per day; the `unique (user_id, day)` constraint doubles
  as the lookup index. No load concern at MVP single-user scale.

## Migration Notes

- Forward-only (AGENTS.md). The `wellness_entries` migration applies locally via `db reset` during dev
  and reaches cloud via `npx supabase db push` on merge to `master`. No existing data to migrate.
  Widening a range later (e.g. the water ceiling) is a new `alter ... drop/add constraint` migration.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-05)
- PRD: FR-007 — `context/foundation/prd.md`
- Change identity + locked decisions: `context/changes/wellness-logging/change.md`
- Singleton-per-day slice to mirror (table + JSON API + island): `context/changes/biomarker-gki-logging/plan.md`,
  `supabase/migrations/20260630120001_biomarker_readings.sql`, `src/pages/api/biomarkers/index.ts`,
  `src/components/biomarkers/BiomarkerLogger.tsx`, `src/lib/services/biomarkers.ts`
- All-nullable partial-save precedent: `src/lib/services/profile.ts`, `src/types.ts:54` (`HealthProfile`),
  `supabase/migrations/20260617072330_health_profiles.sql`
- RLS pattern + proof to copy: `supabase/migrations/20260609151323_isolation_canary.sql`, `supabase/tests/biomarker_readings_rls.sql`
- SSR client: `src/lib/supabase.ts`; route protection (unchanged): `src/middleware.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundations — migration, RLS proof, types

#### Automated

- [x] 1.1 Migration applies cleanly locally: `npx supabase db reset` runs without error
- [x] 1.2 Table + 4 policies exist (psql pg_policy query returns 4 rows)
- [x] 1.3 `unique (user_id, day)` constraint exists (`\d public.wellness_entries`)
- [x] 1.4 Typecheck/lint pass: `npx astro sync && npm run lint`

#### Manual

- [x] 1.5 `wellness_entries_rls.sql` proof passes; user B sees only its own row
- [x] 1.6 CHECK rejects out-of-range (mood 11 / negative water); all-NULL insert accepted
- [x] 1.7 `src/types.ts` wellness types match the migration columns

### Phase 2: Wellness service + JSON API route

#### Automated

- [ ] 2.1 Typecheck/lint pass: `npx astro sync && npm run lint`
- [ ] 2.2 Build succeeds: `npm run build`

#### Manual

- [ ] 2.3 Partial POST (subset of fields) returns an entry with the rest `null` and `201`; row in Studio
- [ ] 2.4 Second POST for the same day updates the same row; a `null` field clears that column
- [ ] 2.5 GET returns the day's entry, or `{ entry: null }` when none exists
- [ ] 2.6 POST with an out-of-range value returns `400`, persists nothing
- [ ] 2.7 POST with all fields null/absent returns `400` (at-least-one guard), persists nothing
- [ ] 2.8 DELETE removes the row (`200`); second DELETE for the same day returns `404`
- [ ] 2.9 Unauthenticated GET/POST/DELETE rejected with `401`

### Phase 3: UI — WellnessLogger dashboard island

#### Automated

- [ ] 3.1 Typecheck/lint pass: `npx astro sync && npm run lint`
- [ ] 3.2 Build succeeds: `npm run build`

#### Manual

- [ ] 3.3 Empty Wellness section on a day with no entry
- [ ] 3.4 Partial save (subset of fields) shows values in place without a full reload; row in Studio
- [ ] 3.5 Re-save updates the readout, keeps a single row, clears a blanked field to `null`
- [ ] 3.6 Clear/delete removes the entry, returns to empty state
- [ ] 3.7 Out-of-range value, or all-blank submit, shows inline error and persists nothing
- [ ] 3.8 Reloading `/dashboard` re-fetches and shows today's saved entry
- [ ] 3.9 Logged-out `/dashboard` redirects to signin; second user sees empty section; no regressions
