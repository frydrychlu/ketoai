# Diet & Activity Correlation Visualizations (S-07) Implementation Plan

## Overview

Extend the existing `/trends` page so a keto practitioner can see their biomarker trends **visualized against
their diet (macros) and activity data over the same time window** — the visual payoff of the product's core
bet (FR-010). Below the GKI and ketones/glucose charts that S-06 already ships, add two **date-aligned bar
charts** sharing the same 7 / 14 / 30-day window: a **stacked fat/protein/carbs** diet chart and an
**activity kcal-burned** chart. Because all charts share one date x-axis and column positions, the user scans
straight down from a GKI swing to see what they ate and how they moved on those days ("aligned
small-multiples"). The slice reads the existing `meals`, `activities`, and `biomarker_readings` tables
(RLS-scoped) — no new table, no charting library, and no chart-point drill-down (an explicit Non-Goal).

## Current State Analysis

- **The trends page and its island already exist.** `src/pages/trends.astro` mounts
  `src/components/biomarkers/BiomarkerTrends.tsx` (`client:load`), which owns the 7/14/30-day window toggle
  (`localDay()` + `daysBefore()`), fetches `/api/biomarkers?from=&to=`, and renders the GKI hero chart and
  the ketones/glucose dual-axis chart. `/trends` is already in `PROTECTED_ROUTES`.
- **A reusable SVG `LineChart` primitive exists** (`src/components/biomarkers/LineChart.tsx`) and was
  deliberately built generic — its header comment says "later S-07's correlation charts can all reuse it." It
  positions points by real calendar date within `[from, to]` (`dayToX`), supports left/right axes and bands,
  and uses fixed plot padding (`padLeft=44`, `padRight=16` when no right axis). **It draws lines/dots only —
  no bars.**
- **Biomarkers already have a range read**, meals and activities do NOT.
  - `src/lib/services/biomarkers.ts` → `listReadings(from, to)`; `GET /api/biomarkers` has a `?from=&to=`
    range branch with `daySchema`, a `from <= to` guard, and a `MAX_RANGE_DAYS = 366` span cap.
  - `src/lib/services/meals.ts` → only `getDailyTotal(day)` (single day) + the pure `sumDailyTotal(rows)`.
    `GET /api/meals` accepts only `?day=`, returns `{ meals, total }`.
  - `src/lib/services/activities.ts` → only `getDailyExpenditure(day)` + the pure `sumDailyExpenditure(rows)`.
    `GET /api/activities` accepts only `?day=`, returns `{ activities, total }`.
- **PostgREST has no easy GROUP BY.** Meals and activities are multiple rows per day; the daily series must be
  aggregated in JS over a bounded range scan (mirroring the existing pure `sumDaily*` helpers), not via a SQL
  aggregate.
- **Shared types live in `src/types.ts`** (per AGENTS.md): `Meal`/`MacroBreakdown`/`DailyMacroTotal`,
  `Activity`/`DailyExpenditureTotal` are already defined.
- **Patterns to mirror:** the biomarkers route is the exact template for a `?from=&to=` range branch;
  `BiomarkerTrends.tsx` is the template for window state, fetch/abort, loading/error/empty rendering, and the
  `localDay()`/`daysBefore()` "do NOT extract" duplication convention.

## Desired End State

Signed in at `/trends`, a user sees (top to bottom, all under one 7/14/30-day toggle): the existing GKI chart,
the existing ketones/glucose chart, then a **stacked macro bar chart** (fat + protein + carbs per day) and an
**activity kcal-burned bar chart**. Every chart shares the same date x-axis and column positions, so dates
line up vertically for eyeballing correlations. Same-day alignment — each date column shows that calendar
day's reading, diet, and activity, with no day-shifting. Each of the diet and activity charts shows its own
guided empty state when its stream has no data in the window, while the others still render (partial data is
common). A sparse-data hint appears when a stream is thin. Switching the window re-fetches and redraws all
charts. Unauthenticated access still redirects to `/auth/signin`; RLS keeps every read owner-scoped. Lint,
typecheck, and build pass; the Worker bundle stays well under the 10 MB free-tier cap (no new dependency).

### Key Discoveries:

- `LineChart` positions by real date via `dayToX(day, from, to, width)` (`src/components/biomarkers/LineChart.tsx:56`);
  the new `BarChart` must use the **same window and the same plot padding** so bars sit in the same columns as
  the line chart above — this is what makes the small-multiples alignment work.
- The pure `sumDailyTotal(rows)` (`src/lib/services/meals.ts:7`) and `sumDailyExpenditure(rows)`
  (`src/lib/services/activities.ts:7`) already fold rows → a day total; the range reads reuse them per-day
  group, so aggregation logic isn't duplicated.
- The biomarkers `GET` range branch (`src/pages/api/biomarkers/index.ts:39`) is a drop-in template:
  `daySchema`, `from <= to` (ISO strings compare chronologically), `MAX_RANGE_DAYS` span cap, `{ readings }`
  response. Copy its shape for meals/activities.
- `meals`/`activities` rows carry a `day` (ISO `YYYY-MM-DD`) column already indexed by the S-01/S-04
  migrations; a bounded date-range scan over one user's rows is trivially cheap at MVP scale.

## What We're NOT Doing

- **No chart-point drill-down / click-to-expand / popups** — explicit PRD & roadmap Non-Goal ("viewing
  details from the visualized trend" / "date selection is via a calendar control, not chart interaction").
  Day-level read-back is S-08's job via a calendar control.
- **No new table, migration, or RLS change** — reads existing `meals`, `activities`, `biomarker_readings`.
- **No charting library** — the `BarChart` is hand-rolled SVG, matching the `LineChart` decision (zero bundle
  delta).
- **No day-shifting / "align morning reading to prior day"** — same-day columns only (chosen for honesty; a
  shifted view is a possible future enhancement, not in this slice).
- **No computed correlation coefficient or statistics** — correlation is visual (aligned charts), not a
  number the app derives.
- **No changes to the biomarker charts** — the GKI and ketones/glucose charts render exactly as today.
- **No writes** — meals/activities `POST`/`DELETE` and the biomarker routes are untouched.
- **No new page or second window toggle** — the charts extend the existing `/trends` island under its single
  shared window.
- **No test framework** — correctness rests on typecheck/lint/build + a manual walkthrough, matching S-01–S-06
  and current CI.

## Implementation Approach

Bottom-up in three independently verifiable phases, mirroring S-06:

1. **Data layer** — add JS-aggregated daily range reads to the meals and activities services, and a
   `?from=&to=` range branch to each `GET` route (copied from the biomarkers route), returning a compact
   per-day series. The single-day (`?day=`) behavior the dashboard loggers depend on is preserved. Verifiable
   by curl before any UI exists.
2. **`BarChart` primitive** — a small, pure, dependency-free SVG bar chart supporting stacked bars (diet) and
   single-series bars (activity), positioning each day's bar on the **same date x-domain and plot padding as
   `LineChart`** so columns align across the stacked charts. Verifiable by typecheck/lint/build and rendering.
3. **Correlation charts in the island** — extend `BiomarkerTrends.tsx` to also fetch the diet + activity
   ranges on the shared window and render the two new bar charts below the existing ones, each with its own
   guided empty state and a sparse hint. Verifiable by a manual walkthrough with logged data.

RLS makes every range read owner-scoped automatically, so no new auth surface is added. Aggregation stays in
small pure helpers (reusing `sumDaily*`) so it's testable-by-reading.

## Critical Implementation Details

- **Column alignment is the load-bearing constraint.** For the small-multiples to read as correlated, the
  `BarChart` and the existing `LineChart` must map dates to the same horizontal positions: identical `from`/`to`
  window, identical `padLeft`/`padRight`, and the same `dayToX` fraction-of-window math. A bar for a given day
  must sit directly under that day's point on the GKI line. Bar **width** is derived from one day's fraction of
  the window (`plotW / windowDays`), clamped to a sensible min, and centered on the day's x — so a 7-day window
  shows fat bars and a 30-day window shows thin bars, both still column-aligned.
- **Sparse series = gaps, not zeros.** A day with no meals/no activity has **no bar** (a gap), exactly as the
  line chart skips unlogged days. Do not synthesize zero-height bars for unlogged days — that would falsely
  imply "logged, and it was zero." Only days present in the returned series get a bar.
- **Stacked-bar domain.** The diet chart's y-domain is driven by the **stacked total** (fat+protein+carbs
  grams) per day, so the tallest day's stack fits; each segment is drawn bottom-up in a fixed order with a
  fixed color per macro, matched to a legend.

## Phase 1: Range reads — meals & activities service + API

### Overview

Add bounded, JS-aggregated daily range reads to the meals and activities services and expose each through its
existing `GET` route via a `?from=&to=` branch, without disturbing the single-day (`?day=`) behavior the
dashboard loggers depend on. Mirrors the biomarkers range branch exactly.

### Changes Required:

#### 1. Daily-total range read in the meals service

**File**: `src/lib/services/meals.ts`

**Intent**: Add a `listDailyTotals` function returning one aggregated macro total per day (only days that have
meals) across an inclusive `[from, to]` range, ordered by day ascending, so the trends island can chart a diet
series. RLS scopes the query to the caller (no explicit `user_id` filter), mirroring `getDailyTotal`.

**Contract**: `listDailyTotals(supabase, from, to): Promise<DailyMacroSeriesPoint[]>` — select
`day, fat_g, protein_g, carbs_g, calories_kcal` where `day` in `[from, to]`, then group rows by `day` in JS
and fold each group with the existing pure `sumDailyTotal(rows)`. Return an array of `{ day, ...DailyMacroTotal }`
sorted by `day`. Days with no meals are simply absent (no zero rows). `from`/`to` are ISO `YYYY-MM-DD`, caller
guarantees `from <= to`.

#### 2. Daily-expenditure range read in the activities service

**File**: `src/lib/services/activities.ts`

**Intent**: Add a `listDailyExpenditure` function returning one aggregated kcal-burned total per day (only days
with activities) across `[from, to]`, ordered by day ascending, for the activity chart. RLS-scoped, mirroring
`getDailyExpenditure`.

**Contract**: `listDailyExpenditure(supabase, from, to): Promise<DailyExpenditureSeriesPoint[]>` — select
`day, calories_kcal` where `day` in `[from, to]`, group by `day` in JS, fold each group with
`sumDailyExpenditure(rows)`, return `{ day, calories_kcal }[]` sorted by `day`. Absent days = no row.

#### 3. New series DTO types

**File**: `src/types.ts`

**Intent**: Add the two per-day series point types the range reads and the island share, so the daily-series
shape is named once (per AGENTS.md, shared types live here).

**Contract**: `DailyMacroSeriesPoint = { day: string } & DailyMacroTotal;` and
`interface DailyExpenditureSeriesPoint { day: string; calories_kcal: number }`. Documented as "one aggregated
day in a range series."

#### 4. Range branch on the meals GET route

**File**: `src/pages/api/meals/index.ts`

**Intent**: Extend `GET` so that when `from` and `to` are both present it returns the aggregated diet series as
`{ dailyTotals }`; when only `day` is present it keeps returning `{ meals, total }` exactly as today. Copy the
biomarkers route's range guards.

**Contract**: Reuse the existing `daySchema`; add the `MAX_RANGE_DAYS = 366` span cap and a `from <= to` guard
(string compare valid for ISO dates). Precedence: `from`/`to` both present → range branch → `listDailyTotals`
→ `Response.json({ dailyTotals })`; else the current `day` branch, unchanged. Invalid/missing range params →
400; unauthenticated → 401 (as today). `POST` untouched.

#### 5. Range branch on the activities GET route

**File**: `src/pages/api/activities/index.ts`

**Intent**: Same extension for activities: `from`/`to` → `{ dailyExpenditures }`; `day` → `{ activities, total }`
unchanged.

**Contract**: Same guards as #4. Range branch → `listDailyExpenditure` → `Response.json({ dailyExpenditures })`.
`POST` untouched.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- `GET /api/meals?from=YYYY-MM-DD&to=YYYY-MM-DD` returns `{ dailyTotals: [...] }` — one entry per day that has
  meals, aggregated and ordered by day; `[]` for an empty range.
- `GET /api/activities?from=&to=` returns `{ dailyExpenditures: [...] }` similarly.
- `GET /api/meals?day=` and `GET /api/activities?day=` still return their original `{ meals, total }` /
  `{ activities, total }` shapes (loggers unaffected).
- Invalid range params (`from > to`, malformed date, span > cap) return 400; unauthenticated returns 401.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: `BarChart` SVG primitive

### Overview

Add a dependency-free SVG `BarChart` sibling to `LineChart` that renders a sparse daily series as bars —
stacked (diet: fat/protein/carbs) or single-series (activity: kcal) — positioned on the same date x-domain and
plot padding as `LineChart`, so bars sit in the same columns as the biomarker line above them.

### Changes Required:

#### 1. Reusable SVG bar-chart primitive

**File**: `src/components/biomarkers/BarChart.tsx` (new)

**Intent**: A theme-styled, pure SVG chart that plots one bar per day of a daily series against a linear
y-scale, supporting stacked segments (multiple values per day drawn bottom-up) and a single series, with a
left-axis label/unit, gridlines, and start/mid/end date x-labels — matching `LineChart`'s visual language.
Kept generic so both the diet and activity charts (and any future daily-total view) reuse it.

**Contract**: Props roughly
`{ from: string; to: string; days: { day: string; segments: { key: string; value: number; color: string }[] }[]; leftAxis: { label: string; unit: string }; height?: number }`
(a single-series chart passes one segment per day). Reuse the **same** `VIEW_W`, `padLeft`, `padRight`, and the
`dayToX` fraction-of-window mapping as `LineChart` so columns align (extract the shared date-scale helper, or
duplicate it consistent with the existing "do NOT extract localDay" convention — implementer's call, but the
math must match). Bar width = `plotW / max(windowDays, 1)` minus a small gutter, min-clamped, centered on the
day's x. Y-domain from `[0, max stacked total]` with headroom. Bars only for days present in `days` (no
zero-bars for absent days). A stacked day draws its segments bottom-up in array order, each at its `color`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Build produces the Worker bundle with **no new dependency** in `package.json`.

#### Manual Verification:

- Rendered in isolation (or via Phase 3), a stacked day shows fat/protein/carbs segments summing to the day's
  total; a single-series day shows one bar.
- Bars for a given date sit at the same x-position as that date on a `LineChart` with the same `from`/`to`
  (column alignment holds across a 7-day and a 30-day window).
- A window with gaps shows bars only on days present in the series (no phantom zero bars).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Correlation charts in the trends island

### Overview

Extend `BiomarkerTrends.tsx` to also fetch the diet and activity ranges on the shared window and render the two
new bar charts below the existing biomarker charts, each with its own guided empty state and a sparse hint —
completing the aligned small-multiples correlation view.

### Changes Required:

#### 1. Fetch diet + activity ranges on the shared window

**File**: `src/components/biomarkers/BiomarkerTrends.tsx`

**Intent**: Alongside the existing biomarkers fetch, fetch `/api/meals?from=&to=` and
`/api/activities?from=&to=` for the same `[from, to]` window on mount and on every range change, storing the
two new series in state. Reuse the existing `AbortController`/loading/error idiom; a failure in a diet/activity
fetch degrades that chart's section (shows its empty/unavailable state), not the whole page.

**Contract**: Add `dailyTotals: DailyMacroSeriesPoint[]` and `dailyExpenditures: DailyExpenditureSeriesPoint[]`
state; fetch all three endpoints for the window (parallel `fetch`es under the one `AbortController`). Window
math (`localDay()`, `daysBefore`, `to`/`from`) is unchanged and shared across all charts.

#### 2. Diet stacked-macro bar chart

**File**: `src/components/biomarkers/BiomarkerTrends.tsx`

**Intent**: Below the ketones/glucose chart, render a `BarChart` of the daily macro split — one stacked bar per
logged day (fat + protein + carbs, grams) — with a legend and its own guided empty state when no meals fall in
the window.

**Contract**: Map `dailyTotals` → `BarChart` `days` with three segments per day (`fat_g`/`protein_g`/`carbs_g`,
fixed colors + labels, carbs visually findable), `leftAxis={label:"Makro", unit:"g"}`. When
`dailyTotals.length === 0`, show a guided empty state (message + link to `/dashboard`) in place of the chart,
mirroring the existing biomarker empty state. A sparse hint appears when the series is thin (≤ 2 days).

#### 3. Activity kcal-burned bar chart

**File**: `src/components/biomarkers/BiomarkerTrends.tsx`

**Intent**: Below the diet chart, render a single-series `BarChart` of daily estimated kcal burned, with its
own guided empty state when no activity falls in the window.

**Contract**: Map `dailyExpenditures` → `BarChart` `days` with one segment per day (`calories_kcal`),
`leftAxis={label:"Aktywność", unit:"kcal"}`. Own empty state + sparse hint, independent of the diet chart's.

#### 4. Section layout & headings

**File**: `src/components/biomarkers/BiomarkerTrends.tsx`

**Intent**: Add the two new charts as sections in the existing vertical stack, with Polish section headings
consistent with the existing "GKI" / "Ketony i glukoza" headings, so the whole page reads as one aligned
correlation view under the single window toggle.

**Contract**: Two new `<section>`s ("Dieta (makro)", "Aktywność" or similar) following the existing pattern;
the top-level range toggle and the overall (all-streams-empty) fallback are unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Build passes with no new charting dependency in `package.json`.

#### Manual Verification:

- With meals, activities, and biomarkers logged across the window, `/trends` shows the GKI and ketones/glucose
  charts followed by a stacked macro bar chart and an activity kcal chart; all four share the date axis and
  columns align.
- Logging only biomarkers (no meals/activity) shows the biomarker charts plus per-chart empty states for diet
  and activity — the page is not blanked.
- Switching 7/14/30 re-fetches and redraws all charts on the same window; bars stay column-aligned with the
  lines.
- A window with a skipped diet day shows a gap (no bar) there while the GKI line still spans the gap.
- Signed out, `/trends` still redirects to `/auth/signin`; a second user sees only their own data.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

No automated test framework exists in the repo (consistent with S-01–S-06); verification is typecheck + lint +
build plus a manual walkthrough. The seed scripts (`npm run seed:trends`) populate biomarker readings; log a
few meals and activities via the dashboard to exercise the diet/activity charts.

### Manual Testing Steps:

1. Sign in with a fresh account; open `/trends` → biomarker charts show their empty state, and the diet and
   activity sections show their own guided empty states.
2. Log meals and activities across several non-consecutive days on `/dashboard`, plus a few biomarker readings;
   open `/trends` → all four charts render; verify a GKI column lines up vertically with that day's macro stack
   and activity bar.
3. Confirm the diet chart's stacked segments (fat/protein/carbs) match the logged meals and the legend colors;
   confirm the activity bars match logged kcal.
4. Log biomarkers but no activity for the window → biomarker + diet charts render, activity chart shows its
   empty state (page not blanked).
5. Toggle 7 / 14 / 30 → all charts re-fetch and redraw; bars remain column-aligned with the lines across
   window sizes.
6. Sign out, hit `/trends` directly → redirect to `/auth/signin`. As a second user, confirm only that user's
   data appears (RLS).

## Performance Considerations

- Each range read is a single indexed, bounded scan over one user's rows, aggregated in JS — negligible at MVP
  scale (≤ ~30 days).
- The island now issues three parallel range fetches per window change instead of one; all are small,
  owner-scoped reads.
- SVG rendering of ≤ ~90 bars/points per series is trivial; no memoization needed.
- **Bundle:** the hand-rolled `BarChart` adds no dependency, keeping the Worker bundle unchanged and well under
  the 10 MB free-tier cap. Verify the `package.json` diff adds nothing.

## Migration Notes

None — no schema change. Reads the existing `meals`, `activities`, and `biomarker_readings` tables and their
RLS unchanged.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-07, FR-010)
- Reference slice (mirror its structure): `context/archive/2026-07-01-biomarker-trend-dashboard/plan.md` (S-06)
- Range-branch template: `src/pages/api/biomarkers/index.ts:39` (`GET`, `daySchema`, `MAX_RANGE_DAYS`)
- Services to extend: `src/lib/services/meals.ts:7` (`sumDailyTotal`), `src/lib/services/activities.ts:7`
  (`sumDailyExpenditure`)
- Chart primitive to reuse / mirror: `src/components/biomarkers/LineChart.tsx` (`dayToX`, padding, axes)
- Island to extend: `src/components/biomarkers/BiomarkerTrends.tsx` (window state, fetch/abort, empty states)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Range reads — meals & activities service + API

#### Automated

- [x] 1.1 Type checking passes — 2f97489
- [x] 1.2 Linting passes — 2f97489

#### Manual

- [x] 1.3 `GET /api/meals?from=&to=` returns aggregated `{ dailyTotals }` ordered by day; `[]` for empty range — 2f97489
- [x] 1.4 `GET /api/activities?from=&to=` returns aggregated `{ dailyExpenditures }` similarly — 2f97489
- [x] 1.5 Single-day (`?day=`) meals and activities responses are unchanged — 2f97489
- [x] 1.6 Invalid range params return 400; unauthenticated returns 401 — 2f97489

### Phase 2: `BarChart` SVG primitive

#### Automated

- [x] 2.1 Type checking passes — c246ddc
- [x] 2.2 Linting passes — c246ddc
- [x] 2.3 Build produces the Worker bundle with no new dependency in `package.json` — c246ddc

#### Manual

- [x] 2.4 Stacked day shows fat/protein/carbs segments summing to the day total; single-series day shows one bar
- [x] 2.5 Bars sit at the same x-position as the same date on a `LineChart` (column alignment holds at 7 and 30 days)
- [x] 2.6 A window with gaps shows bars only on days present in the series (no phantom zero bars)

### Phase 3: Correlation charts in the trends island

#### Automated

- [x] 3.1 Type checking passes
- [x] 3.2 Linting passes
- [x] 3.3 Build passes with no new charting dependency in `package.json`

#### Manual

- [x] 3.4 With all three streams logged, GKI/ketones/glucose charts + macro bar chart + activity bar chart render, columns aligned
- [x] 3.5 Biomarkers-only data shows per-chart empty states for diet and activity (page not blanked)
- [x] 3.6 7/14/30 toggle re-fetches and redraws all charts; bars stay column-aligned with the lines
- [x] 3.7 A skipped diet day shows a gap (no bar) while the GKI line spans it
- [x] 3.8 Signed out redirects to `/auth/signin`; a second user sees only their own data
