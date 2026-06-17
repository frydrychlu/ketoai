# Health Profile (S-02) Implementation Plan

## Overview

Let a logged-in user create and edit a health profile — age, weight (kg), height (cm), a
five-level activity-level enum, and freeform health goals — on a dedicated `/profile` page. The
profile is a singleton per user (one row, upserted on save), protected by the same per-user RLS
pattern every other table follows, and prefilled from the stored row on each visit. It supplies
the baseline context US-01 assumes and S-09's AI analysis will later consume. This slice has no AI
call and no novel platform risk; it is straight form CRUD on a freshly-proven template.

## Current State Analysis

- **The full slice template exists and is recent.** `meal-macro-logging` (S-01) established every
  layer this slice reuses: a per-user RLS table copied from `isolation_canary`
  (`supabase/migrations/20260615182411_meals.sql`), shared DTOs in `src/types.ts`, a Zod-validated
  JSON API route (`src/pages/api/meals/index.ts`), the SSR client usage, and a `client:load` React
  island on `/dashboard`.
- **Auth + SSR + RLS are wired.** `src/middleware.ts:4` guards `PROTECTED_ROUTES = ["/dashboard"]`
  and attaches `context.locals.user`. `src/lib/supabase.ts` is the only client factory; it scopes
  every query to the logged-in user via RLS and returns `null` when env is unset.
- **The auth form pattern is the right precedent for this form** (not the meals JSON island). The
  auth pages render a React island that does client-side validation then a **native form POST** to a
  server route which redirects (`src/components/auth/SignUpForm.tsx` → `/api/auth/signup`;
  `src/pages/api/auth/signin.ts` uses `formData()` + `context.redirect(...)`). Reusable building
  blocks: `FormField`, `SubmitButton`, `ServerError`, `PasswordToggle` (last not needed here).
- **`src/types.ts` already exists** with the meals DTOs (`MacroBreakdown`, `Meal`, …). This slice
  appends profile types to it (AGENTS.md: shared types live here).
- **RLS table pattern to copy verbatim:** `supabase/migrations/20260609151323_isolation_canary.sql`
  — `id`, `user_id → auth.users on delete cascade`, `enable row level security`, four granular
  `to authenticated` policies keyed on `auth.uid() = user_id`. Re-runnable proof recipe:
  `supabase/tests/isolation_canary_rls.sql` (and the `meals` copy `supabase/tests/meals_rls.sql`).
- **Local Supabase runs in Docker** (db container `supabase_db_10x-astro-starter`, Studio
  `http://127.0.0.1:54323`); migrations auto-apply on `supabase start`, iterate with
  `npx supabase db reset`. `.env`/`.dev.vars` point at local.
- **No test framework** in the repo — CI runs lint + build only. Verification matches that reality
  (lint, `astro sync` typecheck, build, plus the SQL RLS recipe + manual UI walkthrough).

## Desired End State

A logged-in user clicks a "Profile" link on `/dashboard` and lands on `/profile`. The form is
prefilled with whatever they previously saved (empty on first visit). They can fill any subset of
age, weight, height, activity level (a select), and goals (a textarea) and save; the page reloads
prefilled with the saved values and a brief "saved" confirmation. Out-of-range numbers (e.g. weight
700) are caught client-side with an inline field error that blocks submit; should one reach the
server it is rejected and surfaced as an error banner, and nothing is persisted. A second signed-in user
never sees the first user's profile (proven by the copied RLS SQL recipe). Visiting `/profile` while
logged out redirects to `/auth/signin`.

**Verification of end state:** `npm run lint`, `astro sync` typecheck, and `npm run build` all pass;
the `health_profiles` RLS isolation recipe passes locally against two users; manual walkthrough of
create → edit → partial-save → out-of-range-reject → prefill all behave as described.

### Key Discoveries:

- Copy the table + four policies verbatim from
  `supabase/migrations/20260609151323_isolation_canary.sql:16` (swap `isolation_canary` →
  `health_profiles`, add profile columns), exactly as `meals.sql` did.
- **Singleton enforcement = `unique (user_id)`** on the table; the API upserts with
  `.upsert(..., { onConflict: "user_id" })`. This is the only structural difference from `meals`
  (which is a one-to-many collection).
- Nullable columns + Postgres `CHECK` constraints coexist cleanly: a `CHECK` passes on `NULL`, so
  range/enum guards do not block partial saves (omitted fields → NULL).
- The activity enum is a **text column + CHECK list**, not a Postgres `enum` type — text+CHECK is
  trivial to extend with a follow-up migration, matching the forward-only migration convention.
- The SSR `/profile.astro` page reads the existing row directly via the Supabase client (like
  `dashboard.astro` reads `Astro.locals.user`) — **no separate `GET /api/profile` endpoint needed**.
- Native form POST sends `formData()` (strings); the API route coerces to numbers and maps empty
  strings to NULL before Zod validation — mirror `src/pages/api/auth/signin.ts` `formData()` usage.

## What We're NOT Doing

- No date-of-birth / computed age — `age` is a stored integer (PRD says "age").
- No imperial units or unit toggle — fixed `kg` / `cm`.
- No structured/multi-select goals — a single freeform text field.
- No required-field gating and no forced post-registration onboarding redirect — the profile is
  available, not enforced; auth/middleware flow is untouched beyond adding `/profile` to
  `PROTECTED_ROUTES`.
- No profile delete, no avatar/photo, no medications/supplements (PRD Non-Goals).
- No consumption of the profile by any feature yet (S-09 AI analysis is a later slice) — this slice
  only stores and edits it.
- No new test framework — verification matches current CI (lint + build) plus the SQL RLS recipe.
- No changes to the meals slice or the existing auth routes.

## Implementation Approach

Bottom-up, mirroring S-01 so each layer is verifiable before the next depends on it: (1) data + types
foundation (migration with singleton + range/enum guards, RLS proof, shared types); (2) the profile
service + Zod-validated upsert API route; (3) the `/profile` page, the `ProfileForm` island built
from the existing auth form primitives, the dashboard link, and route protection. Each phase is
independently committed.

## Critical Implementation Details

- **Singleton upsert.** The table carries `unique (user_id)`; the API persists with
  `supabase.from("health_profiles").upsert({ user_id, ...fields }, { onConflict: "user_id" })`. RLS
  `with check (auth.uid() = user_id)` still requires `user_id` to be set explicitly from
  `context.locals.user.id` — never trust a client-supplied owner.
- **formData → typed/nullable coercion happens before Zod.** Form fields arrive as strings; an empty
  string means "leave blank" and must become explicit `null`, not `0` or `NaN`. Convert empty
  strings to `null`, coerce non-empty numerics, then validate with a Zod schema whose every field is
  `.nullable()` (accepts `null`). A `0` or out-of-range number is a real validation failure; an empty
  field is not.
- **Upsert must write NULL to cleared fields, so include every column explicitly.** The form submits
  the full field set on every save, so an edit that blanks a previously-set field must NULL that
  column. `.upsert()` serializes to JSON, which drops `undefined` keys, and PostgREST's
  `ON CONFLICT DO UPDATE` only writes columns present in the payload — so the upsert object must list
  all five columns (`age`, `weight_kg`, `height_cm`, `activity_level`, `health_goals`) with their
  value-or-`null`, never omit a key. Mapping empty → `undefined` would silently keep the old value on
  re-save (looks correct on first insert; breaks on edit).

## Phase 1: Foundations — migration, RLS proof, types

### Overview

Create the singleton `health_profiles` table with the proven RLS pattern plus range/enum guards,
copy the isolation proof for it, and declare the shared profile types.

### Changes Required:

#### 1. Health-profiles migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_health_profiles.sql` (timestamp at authoring time, per AGENTS.md filename rule; must sort after `20260615182411`)

**Intent**: Create the per-user singleton `health_profiles` table following the `isolation_canary`
pattern exactly, with nullable profile columns and CHECK guards for ranges and the activity enum.

**Contract**: Table `public.health_profiles` with:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users (id) on delete cascade`
- `unique (user_id)` — enforces one profile row per user (the singleton constraint the upsert targets)
- `age integer` nullable, `check (age is null or (age between 13 and 120))`
- `weight_kg numeric` nullable, `check (weight_kg is null or (weight_kg between 20 and 500))`
- `height_cm numeric` nullable, `check (height_cm is null or (height_cm between 50 and 250))`
- `activity_level text` nullable, `check (activity_level is null or activity_level in ('sedentary','light','moderate','very','extra'))`
- `health_goals text` nullable (freeform)
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
- `enable row level security` + four policies (`health_profiles_select_own`, `_insert_own`,
  `_update_own`, `_delete_own`), each `to authenticated`, keyed on `auth.uid() = user_id` (writes
  with `with check`), copied from the canary migration.

#### 2. Health-profiles RLS isolation proof

**File**: `supabase/tests/health_profiles_rls.sql`

**Intent**: Re-runnable cross-user proof that one user cannot see another's profile — a copy of
`supabase/tests/meals_rls.sql` swapped to `health_profiles`.

**Contract**: Same four-block structure (seed user A, seed user B, assert B sees only its own row,
unrestricted sanity check) inserting valid profile rows (e.g. distinct `age`/`weight_kg`). Asserts
B's visible rows exclude A's.

#### 3. Shared types

**File**: `src/types.ts` (append)

**Intent**: Home for the profile entity + DTO + activity enum, per AGENTS.md.

**Contract**: Export `ActivityLevel` (union of the five string literals), an `ACTIVITY_LEVELS`
readonly tuple (the same five values, for iterating select options), `HealthProfile` (row shape:
`id`, `user_id`, nullable `age`/`weight_kg`/`height_cm`/`activity_level`/`health_goals`,
`created_at`, `updated_at`), and `UpdateHealthProfileCommand` (all profile fields optional/nullable —
the validated upsert payload). Field names mirror the DB columns (snake_case) as the meals types do.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly locally: `npx supabase db reset` runs without error
- Table + 4 policies exist: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -c "select polname from pg_policy pol join pg_class c on c.oid=pol.polrelid where c.relname='health_profiles';"` returns 4 rows
- `unique (user_id)` exists: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -c "\d public.health_profiles"` shows a unique constraint/index on `user_id`
- Typecheck/lint pass: `npx astro sync && npm run lint`

#### Manual Verification:

- `health_profiles_rls.sql` run against the local db container shows the proof passing — user B sees only its own row
- `src/types.ts` profile types match the migration columns (spot-check)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Profile service + upsert API route

### Overview

Add a small profile service (read + upsert) and a Zod-validated `POST /api/profile` route that
coerces the native-form payload, validates ranges, upserts the caller's singleton row, and redirects
auth-style.

### Changes Required:

#### 1. Profile service

**File**: `src/lib/services/profile.ts` (new)

**Intent**: `getProfile(supabase)` and `upsertProfile(supabase, userId, data)` — the single place
that reads and writes the user's profile row, reused by the SSR page (read) and the API route
(write).

**Contract**:
- `getProfile(supabase): Promise<HealthProfile | null>` — selects the single `health_profiles` row
  (RLS scopes to the user) and returns it or `null` when none exists (handle the no-row case without
  throwing).
- `upsertProfile(supabase, userId, data: UpdateHealthProfileCommand): Promise<HealthProfile>` —
  `.upsert({ user_id: userId, age, weight_kg, height_cm, activity_level, health_goals, updated_at: now }, { onConflict: "user_id" }).select().single()`.
  Build the payload with all five columns explicitly (value or `null`) — do NOT spread a partial
  object, or cleared fields won't be NULLed on the conflict-UPDATE path (see Critical Implementation
  Details). `updated_at` is set explicitly because the column default fires only on insert.

#### 2. Upsert API route

**File**: `src/pages/api/profile/index.ts` (new)

**Intent**: `POST` — read the native form submission, coerce/validate it, upsert the caller's
profile, and redirect back to `/profile` (auth-style), surfacing validation errors via a query param.

**Contract**:
- `export const prerender = false;`
- 401 (or redirect to `/auth/signin`) when `context.locals.user` is absent; 500 when the Supabase
  client is unconfigured.
- Read `await context.request.formData()`; map each field: empty/whitespace string → `null`;
  non-empty `age`/`weight_kg`/`height_cm` coerced to numbers; `activity_level`/`health_goals` as strings.
- Validate with a Zod `updateHealthProfileSchema` where every field is `.nullable()` with the range
  bounds from Phase 1 (age 13–120 int, weight 20–500, height 50–250, activity ∈ the five-value enum).
  On failure, redirect to `/profile?error=<message>` (auth-style — `signin.ts` redirects with an
  error param).
- On success: `upsertProfile(...)` with `user_id` from `context.locals.user.id`, then redirect to
  `/profile?saved=1`.

**Note**: Use a Zod enum for `activity_level` whose values are exactly the `ACTIVITY_LEVELS` tuple, so
the route, the DB CHECK, and the form options share one source of truth.

### Success Criteria:

#### Automated Verification:

- Typecheck/lint pass: `npx astro sync && npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `POST /api/profile` (via the Phase 3 form or curl with form-encoded body) with valid values upserts the row (visible in Studio) and redirects to `/profile?saved=1`
- A second submit with different values updates the **same** row (no duplicate) — confirmed by a single row per user in Studio
- A partial submit (only `age`) saves `age` and leaves other columns NULL
- An out-of-range value (e.g. `weight_kg=700`) redirects to `/profile?error=...` and persists nothing
- Unauthenticated POST is rejected (401 or redirect to signin)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: UI — /profile page, form island, dashboard link, route protection

### Overview

Add the `/profile` page (SSR-prefilled), a `ProfileForm` React island built from the existing auth
form primitives, a link to it from the dashboard, and `/profile` to the protected routes.

### Changes Required:

#### 1. Protect the route

**File**: `src/middleware.ts`

**Intent**: Require auth for `/profile`.

**Contract**: Add `"/profile"` to `PROTECTED_ROUTES`. No other middleware change.

#### 2. Profile page

**File**: `src/pages/profile.astro` (new)

**Intent**: Server-render the profile form prefilled with the user's existing row, and surface the
saved/error flash from the redirect query params.

**Contract**: Using the SSR client + `Astro.locals.user`, call `getProfile(...)` for the initial
values. Read `Astro.url.searchParams` for `saved`/`error`. Render the shared `Layout` and mount
`<ProfileForm client:load initial={profile} serverError={error} saved={savedFlag} />`. Include a link
back to `/dashboard`. Match the dashboard's visual shell (cosmic background, card container).

#### 3. ProfileForm island

**File**: `src/components/profile/ProfileForm.tsx` (new)

**Intent**: Client form mirroring `SignUpForm` — native `method="POST" action="/api/profile"`, reusing
the auth field primitives, prefilled from props, optional client-side range hints.

**Contract**:
- Props: `initial: HealthProfile | null`, `serverError?: string | null`, `saved?: boolean`.
- Renders `FormField`s for `age`, `weight_kg`, `height_cm` (numeric inputs), a `<select>` for
  `activity_level` populated from `ACTIVITY_LEVELS` (with human labels) including an empty "—"
  option, and a `<textarea>` for `health_goals`. Each prefilled from `initial`.
- All fields optional — no client-side "required" blocking. But client-side **range** validation
  **blocks submit** (mirror `SignUpForm.handleSubmit` → `validate()` + `preventDefault` on failure):
  an out-of-range `age`/`weight_kg`/`height_cm` marks that field's `FormField` error inline and stops
  the POST, so the lossy server-redirect path is a backstop, not the primary UX (no typed input is
  lost on a bad value). Keep the client range bounds in sync with the Phase 2 Zod schema (server stays
  the source of truth).
- Native form POST (no `fetch`); shows `ServerError` from `serverError` and a success note when
  `saved`. Uses `cn()` from `@/lib/utils`, lucide icons, and the existing form component styling.

#### 4. Dashboard link

**File**: `src/pages/dashboard.astro`

**Intent**: Give the user a way to reach the profile.

**Contract**: Add a "Profile" link (anchor to `/profile`) in the dashboard header, styled like the
existing sign-out control. No other dashboard change.

### Success Criteria:

#### Automated Verification:

- Typecheck/lint pass: `npx astro sync && npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Logged-in user visits `/dashboard`, clicks "Profile", lands on `/profile` with an empty form on first visit
- Filling fields and saving reloads the page prefilled with the saved values and a "saved" confirmation
- Editing and re-saving updates the values (still a single row in Studio)
- Saving only some fields persists those and leaves the rest blank on return
- An out-of-range number shows the inline error and persists nothing
- Visiting `/profile` while logged out redirects to `/auth/signin`
- A second user sees an empty profile (no cross-user leakage); no regressions to dashboard/meals or sign-in/out

**Implementation Note**: Final phase — confirm the full create → edit → prefill loop manually before closing the change.

---

## Testing Strategy

### Unit Tests:

- None added (no framework in the repo, by decision). Validation and upsert behavior are verified
  manually and via the SQL RLS recipe.

### Integration Tests:

- Manual end-to-end against the local Supabase stack.

### Manual Testing Steps:

1. `npx supabase start` (or confirm running), `npm run dev`, sign in.
2. From `/dashboard` click "Profile" → empty form on `/profile`.
3. Fill age/weight/height, pick an activity level, type goals → save → page returns prefilled + "saved".
4. Change weight → save → value updates; confirm a single row in Studio.
5. Clear all but `age` → save → only `age` persists, others NULL.
6. Enter `weight_kg=700` → save → inline error, nothing persisted.
7. Run `supabase/tests/health_profiles_rls.sql` via the db container → proof passes, B sees only its own.
8. Sign in as a second user → empty profile; sign out / dashboard / meals still work.

## Performance Considerations

- Single-row read and upsert per user; `unique (user_id)` doubles as the lookup index. No load
  concern at MVP single-user scale.

## Migration Notes

- Forward-only (AGENTS.md). The `health_profiles` migration applies locally via `db reset` during
  dev and reaches cloud via `npx supabase db push` on merge to `master`. No existing data to migrate.
  Extending the activity enum later is a new `alter ... drop/add constraint` migration.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-02)
- PRD: FR-003, US-01 — `context/foundation/prd.md`
- Change identity + locked decisions: `context/changes/health-profile/change.md`
- Slice template to mirror: `context/changes/meal-macro-logging/plan.md`
- RLS pattern to copy: `supabase/migrations/20260609151323_isolation_canary.sql`; existing copy `supabase/migrations/20260615182411_meals.sql`
- Isolation proof to copy: `supabase/tests/meals_rls.sql`
- Auth form precedent: `src/components/auth/SignUpForm.tsx`, `src/pages/api/auth/signin.ts`
- SSR client: `src/lib/supabase.ts`; route protection: `src/middleware.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundations — migration, RLS proof, types

#### Automated

- [x] 1.1 Migration applies cleanly locally: `npx supabase db reset` runs without error — 0b8dc4a
- [x] 1.2 Table + 4 policies exist (psql pg_policy query returns 4 rows) — 0b8dc4a
- [x] 1.3 `unique (user_id)` constraint exists (`\d public.health_profiles`) — 0b8dc4a
- [x] 1.4 Typecheck/lint pass: `npx astro sync && npm run lint` — 0b8dc4a

#### Manual

- [x] 1.5 `health_profiles_rls.sql` proof passes; user B sees only its own row — 0b8dc4a
- [x] 1.6 `src/types.ts` profile types match the migration columns — 0b8dc4a

### Phase 2: Profile service + upsert API route

#### Automated

- [x] 2.1 Typecheck/lint pass: `npx astro sync && npm run lint`
- [x] 2.2 Build succeeds: `npm run build`

#### Manual

- [x] 2.3 Valid POST upserts the row (visible in Studio) and redirects to `/profile?saved=1`
- [x] 2.4 A second submit updates the same row (no duplicate)
- [x] 2.5 Partial submit saves provided fields, leaves the rest NULL
- [x] 2.6 Out-of-range value redirects to `/profile?error=...` and persists nothing
- [x] 2.7 Unauthenticated POST rejected (401 or redirect to signin)

### Phase 3: UI — /profile page, form island, dashboard link, route protection

#### Automated

- [ ] 3.1 Typecheck/lint pass: `npx astro sync && npm run lint`
- [ ] 3.2 Build succeeds: `npm run build`

#### Manual

- [ ] 3.3 Dashboard "Profile" link → `/profile` with an empty form on first visit
- [ ] 3.4 Save reloads prefilled with saved values + "saved" confirmation
- [ ] 3.5 Edit + re-save updates values (still a single row in Studio)
- [ ] 3.6 Partial save persists provided fields, leaves rest blank on return
- [ ] 3.7 Out-of-range number shows inline error, persists nothing
- [ ] 3.8 `/profile` while logged out redirects to `/auth/signin`
- [ ] 3.9 Second user sees an empty profile; no dashboard/meals/auth regressions
