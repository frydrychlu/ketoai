# Past-Day Read-Only View Implementation Plan

## Overview

Implement roadmap slice **S-08** (PRD FR-011, US-02): from the app, the user opens a dedicated `/history` page, selects a calendar date (bounded to today or earlier), and sees that day's logged **meals + daily macro summary**, **physical activity + estimated expenditure**, **biomarkers (ketones, glucose, GKI)**, and **wellness parameters** — all in **read-only** mode. No entry can be created, edited, or deleted from this view.

The defining constraint discovered during research: **every entry type already exposes a single-day read endpoint** returning exactly the data this view needs. This slice therefore adds **no backend, API, migration, or data-model code** — it is a presentation slice: one new Astro page, one new React island, and a set of display-only components, plus one middleware line and one dashboard nav link.

## Current State Analysis

- **Dashboard** (`src/pages/dashboard.astro`) is the write surface — it mounts four `client:load` logger islands (`MealLogger`, `ActivityLogger`, `BiomarkerLogger`, `WellnessLogger`), each of which fetches its own `?day=<today>` data on mount and provides create/edit/delete UI.
- **Single-day read endpoints already exist** for all four types and return read-ready shapes:
  - `GET /api/meals?day=YYYY-MM-DD` → `{ meals: Meal[], total: DailyMacroTotal }` (`src/pages/api/meals/index.ts:82`)
  - `GET /api/activities?day=YYYY-MM-DD` → `{ activities: Activity[], total: { calories_kcal } }` (`src/pages/api/activities/index.ts:82`)
  - `GET /api/biomarkers?day=YYYY-MM-DD` → `{ reading: BiomarkerReading | null }` (`src/pages/api/biomarkers/index.ts:79`)
  - `GET /api/wellness?day=YYYY-MM-DD` → `{ entry: WellnessEntry | null }` (`src/pages/api/wellness/index.ts:54`)
  - Each validates `day` with an identical `daySchema` (regex + real-date refine) and is auth-guarded on `context.locals.user`.
- **Page pattern** is proven by `src/pages/trends.astro`: `Layout` + cosmic background + `max-w-2xl` glass panel + a header with title/email and a nav link back, wrapping a single `client:load` island. `/history` mirrors this exactly.
- **Route protection** is a single array in `src/middleware.ts:4` (`PROTECTED_ROUTES`); `startsWith` matching means adding `"/history"` protects the page and any sub-path.
- **Reusable rendering:** `src/components/meals/DailyTotal.tsx` renders a `DailyMacroTotal` as a 4-tile grid — reused verbatim for the macro summary.
- **Shared types** already model every row: `Meal`, `Activity`, `BiomarkerReading`, `WellnessEntry`, `DailyMacroTotal` in `src/types.ts`.
- **No date-picker primitive is installed** — `src/components/ui/` contains only `button.tsx`. A native `<input type="date">` avoids adding any dependency (Worker bundle size is an `infrastructure.md` watch item).
- **Date convention:** `day` is a browser-**local** `YYYY-MM-DD` string everywhere; the loggers compute "today" from the browser clock. The history view must do the same so the picker's upper bound and default match the user's local calendar day.

## Desired End State

A signed-in user can:

1. Click **History** in the dashboard header → land on `/history` (unauthenticated access redirects to `/auth/signin`).
2. See a native date picker defaulted to **today**, with a `max` of today (local) so future dates cannot be chosen.
3. See four always-present sections — Meals (with macro summary), Activity (with expenditure total), Biomarkers (with GKI), Wellness — rendered **read-only** for the selected day.
4. Change the date and see all four sections refresh for the new day.
5. See a clear **per-type empty state** for any section with no data that day.
6. Click **Back to dashboard** to return to the editable current-day view.

**Verification:** `/history` is reachable only when authenticated; picking a date issues four parallel `?day=` requests; every section renders read-only with no input/button/form that mutates data; empty and populated days both render correctly; `npm run lint` and `npm run build` pass.

### Key Discoveries:

- All four single-day read endpoints already exist and are read-ready — no backend work (`src/pages/api/*/index.ts`).
- `/trends` (`src/pages/trends.astro`) is a copy-ready page template.
- `DailyTotal.tsx` renders the macro summary from `{ total }` and is reused as-is.
- `PROTECTED_ROUTES` in `src/middleware.ts:4` uses `startsWith` — one array entry protects the route.
- `day` is browser-local `YYYY-MM-DD`; compute today/`max` from the local clock, not UTC, to avoid off-by-one at day boundaries.

## What We're NOT Doing

- **No backend, API, service, or migration changes.** The existing `?day=` endpoints are consumed as-is.
- **No aggregate `/api/day` endpoint** — four parallel client calls reuse the proven endpoints.
- **No create / edit / delete** on the history view (US-02) — read-only by construction.
- **No chart drill-down** from a trend data point to a day (PRD Non-Goal — selection is via the calendar control only).
- **No CSV/PDF export and no side-by-side day comparison** (out of MVP scope).
- **No new date-picker dependency** (no shadcn Calendar / react-day-picker) — native input only.
- **No change to the dashboard's editing behavior** — only a nav link is added.

## Implementation Approach

Copy the `/trends` page shell for `/history`, protect the route, and add a dashboard nav link. Build one read-only island (`DayHistory`) that owns: the selected date (state, default = local today), a native `<input type="date" max={localToday}>`, and a fetch effect that fires the four `?day=` endpoints in parallel via `Promise.all` on every date change, tracking a single loading flag and a single error flag. Render four always-present sections through small display-only components (no forms/inputs/mutating buttons), each with its own empty state. Reuse `DailyTotal` for the macro grid. This keeps the read-only guarantee structural (there is no write path in these components) and confines all new logic to the `history` page + `history` component folder.

## Critical Implementation Details

- **Local-date computation.** Derive both the picker default and its `max` from the browser's local clock as `YYYY-MM-DD` (e.g. via local get-year/month/date with zero-padding), matching how the loggers already build `day`. Do **not** use `toISOString()` (UTC) — near midnight that yields the wrong calendar day and would let a "future" local date slip in or bound the picker a day early.
- **User-experience spec.** All four sections render on every day (populated or empty) so the layout is stable and the read-only contract is obvious; changing the date must refresh all four together (one loading state), not leave stale sections from the previous day visible.

## Phase 1: History page scaffold, routing & date selection

### Overview

Stand up the protected `/history` page, the dashboard entry point, and the island shell that selects a date and fetches all four entry types in parallel — with loading and error handling — before any read-only rendering is added.

### Changes Required:

#### 1. History page

**File**: `src/pages/history.astro`

**Intent**: Provide the page shell for the past-day view, mirroring `/trends` — cosmic background, `max-w-2xl` glass panel, header with title + `user.email` and a "Back to dashboard" link — wrapping the new island with `client:load`.

**Contract**: New Astro page at route `/history`. Imports `Layout` and the new `DayHistory` island. Header includes an `<a href="/dashboard">` back link styled like the existing `/trends` link. No `prerender` export needed (page, not API route; app is full SSR).

#### 2. Protect the route

**File**: `src/middleware.ts`

**Intent**: Require authentication for `/history` so an unauthenticated request redirects to `/auth/signin`, consistent with `/dashboard`, `/profile`, `/trends`.

**Contract**: Add `"/history"` to the `PROTECTED_ROUTES` array (`src/middleware.ts:4`). No other logic changes.

#### 3. Dashboard nav link

**File**: `src/pages/dashboard.astro`

**Intent**: Give the user a way to reach the history view from the dashboard header.

**Contract**: Add a "History" `<a href="/history">` in the header's link group (`dashboard.astro:21-33`), styled identically to the existing "Trends"/"Profile" links.

#### 4. Read-only island shell — date selection + parallel fetch

**File**: `src/components/history/DayHistory.tsx`

**Intent**: Own the selected date and load the day's data. Hold `selectedDay` state defaulting to the browser's local today; render a native `<input type="date">` with `max` = local today so future dates cannot be picked; on mount and whenever `selectedDay` changes, fetch the four `?day=` endpoints in parallel and store their results, with a single loading indicator and a single error message on failure. This phase renders the picker and a minimal placeholder for results (full rendering is Phase 2).

**Contract**: New default-exported React component (no `"use client"`). Local-today and `max` are computed from the local clock as `YYYY-MM-DD` (not `toISOString`). Fetch uses `Promise.all` over the four endpoints:
`/api/meals?day=`, `/api/activities?day=`, `/api/biomarkers?day=`, `/api/wellness?day=`.
Response shapes consumed: `{ meals, total }`, `{ activities, total }`, `{ reading }`, `{ entry }`. State typed with `Meal[]`, `Activity[]`, `BiomarkerReading | null`, `WellnessEntry | null`, `DailyMacroTotal` from `@/types`. Any non-ok response surfaces the single error state. Use `cn()` for class composition.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npx astro check`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- Visiting `/history` while signed out redirects to `/auth/signin`.
- Visiting `/history` while signed in renders the page with a date picker defaulted to today.
- The date picker cannot select a future date (its `max` is today, local).
- Changing the date issues four parallel requests (visible as `?day=` calls in the Network tab) and shows a loading state while they resolve.
- A failed request surfaces a visible error message rather than a blank/crashed view.
- "Back to dashboard" and the dashboard's new "History" link navigate correctly.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Read-only rendering & per-type empty states

### Overview

Render the fetched day data through display-only components — meals + macro summary, activity + expenditure total, biomarkers + GKI, wellness — each always present with its own empty state, completing the read-only view.

### Changes Required:

#### 1. Meals section (read-only)

**File**: `src/components/history/DayMeals.tsx`

**Intent**: Display the day's meals as a read-only list (description + per-meal macros) with the daily macro summary above/below it; reuse the existing macro-grid component. Show a "No meals logged" empty state when the list is empty (still rendering the section and a zeroed/absent summary consistently).

**Contract**: New component taking `meals: Meal[]` and `total: DailyMacroTotal`. Renders `DailyTotal` (`@/components/meals/DailyTotal`) for the summary. No inputs, forms, or mutating buttons.

#### 2. Activity section (read-only)

**File**: `src/components/history/DayActivities.tsx`

**Intent**: Display the day's activities as a read-only list (description + estimated `calories_kcal`, labeled approximate consistent with the logger) plus the total expenditure; empty state "No activity logged".

**Contract**: New component taking `activities: Activity[]` and `total: { calories_kcal: number }`. Display-only.

#### 3. Biomarkers section (read-only)

**File**: `src/components/history/DayBiomarkers.tsx`

**Intent**: Display the day's single biomarker reading — ketones (mmol/L), glucose (mg/dL), and computed GKI — read-only; empty state "No biomarkers logged" when `reading` is null.

**Contract**: New component taking `reading: BiomarkerReading | null`. Display-only.

#### 4. Wellness section (read-only)

**File**: `src/components/history/DayWellness.tsx`

**Intent**: Display the day's wellness entry — mood, energy, sleep quality, water (L), and notes — read-only, showing only the fields that are non-null; empty state "No wellness data logged" when `entry` is null.

**Contract**: New component taking `entry: WellnessEntry | null`. Nullable fields render as absent/blank rather than "0". Display-only.

#### 5. Wire sections into the island

**File**: `src/components/history/DayHistory.tsx`

**Intent**: Replace the Phase-1 placeholder with the four section components, always rendered in a stable order under section headings that match the dashboard's ("Meals"/macro, "Activity", "Biomarkers", "Wellness"), passing the fetched state into each. Ensure a date change refreshes all four together (no stale sections).

**Contract**: Compose `DayMeals`, `DayActivities`, `DayBiomarkers`, `DayWellness`, passing the typed state from Phase 1. Section headings/dividers styled like `dashboard.astro`. Loading and error states from Phase 1 remain.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npx astro check`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- A day with entries of all four types renders each section's data read-only (meals list + macro summary, activity list + total, biomarker reading + GKI, wellness fields).
- A day with **no** data renders all four sections, each showing its per-type empty state.
- A day with only some types logged shows data for those and empty states for the rest.
- No control in the view can create, edit, or delete an entry (no forms/inputs/mutating buttons present).
- Changing the date replaces all four sections with the new day's data (no stale content).
- GKI, macro totals, and expenditure totals match what the dashboard shows for the same day.
- Layout is consistent with the dashboard/`/trends` cosmic styling.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- No automated test harness exists in this project yet (testing strategy is a Module 3 concern); verification is via type-check, lint, build, and manual UI testing.

### Integration Tests:

- Not applicable for this slice (no new backend). The existing `?day=` endpoints are already exercised by the loggers.

### Manual Testing Steps:

1. Sign in (local Supabase) with an account that has seeded history (`npm run seed:trends` provides biomarker history; log a meal/activity/wellness for a past day if needed).
2. From the dashboard, click **History** → confirm `/history` loads with the date picker defaulted to today.
3. Confirm the picker cannot select a future date.
4. Select a past date known to have all four entry types → confirm all four sections render read-only with correct values (cross-check GKI/macros against the dashboard).
5. Select a date with no data → confirm four per-type empty states.
6. Select a date with partial data → confirm mixed data/empty rendering.
7. Attempt to find any edit/delete/create affordance → confirm none exist.
8. Click **Back to dashboard** → confirm return to the editable current-day view.
9. Sign out, navigate directly to `/history` → confirm redirect to `/auth/signin`.

## Performance Considerations

Four parallel `GET` requests per date change at this app's low QPS and small data volume are negligible. No new dependency is added, so the Worker bundle is unaffected (the native date input keeps this off the `infrastructure.md` bundle-size watch item). Each endpoint is already RLS-scoped and indexed by `(user_id, day)` per the isolation pattern.

## Migration Notes

None — no schema or data changes.

## References

- PRD: `context/foundation/prd.md` — FR-011, US-02
- Roadmap slice: `context/foundation/roadmap.md` — S-08
- Page template: `src/pages/trends.astro`
- Read endpoints: `src/pages/api/{meals,activities,biomarkers,wellness}/index.ts` (`?day=` branch)
- Reused component: `src/components/meals/DailyTotal.tsx`
- Route protection: `src/middleware.ts:4`
- Shared types: `src/types.ts` (`Meal`, `Activity`, `BiomarkerReading`, `WellnessEntry`, `DailyMacroTotal`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: History page scaffold, routing & date selection

#### Automated

- [x] 1.1 Type checking passes: `npx astro sync && npx astro check`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Production build passes: `npm run build`

#### Manual

- [x] 1.4 `/history` while signed out redirects to `/auth/signin`
- [x] 1.5 `/history` while signed in renders with date picker defaulted to today
- [x] 1.6 Date picker cannot select a future date (`max` = local today)
- [x] 1.7 Changing the date issues four parallel `?day=` requests with a loading state
- [x] 1.8 A failed request surfaces a visible error state
- [x] 1.9 "History" (dashboard) and "Back to dashboard" links navigate correctly

### Phase 2: Read-only rendering & per-type empty states

#### Automated

- [x] 2.1 Type checking passes: `npx astro sync && npx astro check`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Production build passes: `npm run build`

#### Manual

- [x] 2.4 Full day renders all four sections read-only with correct values
- [x] 2.5 Empty day renders four per-type empty states
- [x] 2.6 Partial day renders mixed data/empty states
- [x] 2.7 No create/edit/delete affordance exists anywhere in the view
- [x] 2.8 Changing the date replaces all four sections (no stale content)
- [x] 2.9 GKI, macro totals, and expenditure match the dashboard for the same day
- [x] 2.10 Layout consistent with dashboard/`/trends` styling
