# Biomarker Trend Dashboard (S-06) Implementation Plan

## Overview

Add a read-only `/trends` page that charts a keto practitioner's GKI, ketone, and glucose history over
a selectable window (7 / 14 / 30 days, default 30). The page reads the `biomarker_readings` time-series
that S-03 already stores — one row per `(user_id, day)` with `ketones_mmol_l`, `glucose_mg_dl`, and a
stored `gki` — and renders it as **hand-rolled SVG** line charts: a GKI hero chart with ketosis
reference bands on top, and a combined ketones/glucose dual-axis chart below. This satisfies FR-009
("see biomarker trends over time, with an empty state that guides them when data is sparse") and is the
prerequisite for S-07's diet/activity correlation charts.

## Current State Analysis

- **Data is ready.** `supabase/migrations/20260630120001_biomarker_readings.sql` defines the table with
  `unique (user_id, day)`, a stored `gki numeric not null`, and four granular RLS policies scoping every
  operation to `auth.uid() = user_id`. Every stored row already has a valid GKI (S-03 requires both
  inputs), so trend series never have null-GKI gaps within logged days.
- **The service only reads one day.** `src/lib/services/biomarkers.ts` exposes `getReading(supabase, day)`
  (single-day, `.maybeSingle()`), `upsertReading`, `deleteReading`, and the pure `computeGki`. There is
  **no range read** — this slice adds one.
- **The API route is single-day.** `src/pages/api/biomarkers/index.ts` `GET` accepts only `?day=` and
  returns `{ reading }`. It must be extended to also accept a `?from=&to=` range returning `{ readings }`.
- **No charting dependency exists.** `package.json` has no recharts/chart.js/uplot/d3. Charts are
  hand-rolled SVG (decision below) — zero new dependency, zero bundle delta.
- **Island + routing patterns to mirror.** `src/components/biomarkers/BiomarkerLogger.tsx` shows the
  `client:load` fetch/loading/error idiom, `localDay()`, and `round1()` display rounding. UI copy is
  Polish. `src/middleware.ts` protects routes via a `PROTECTED_ROUTES` array (`["/dashboard", "/profile"]`).
  `src/pages/dashboard.astro` shows the glass/cosmic section layout and header link style.

## Desired End State

Signed in, a user opens `/trends` (linked from the dashboard header). With no readings in the window they
see a guided empty state pointing them to log on the dashboard. With one or more readings they see a large
GKI line chart with shaded ketosis zones, and below it a combined ketones/glucose chart on two y-axes;
lines connect continuously across days with no reading, and each real reading is marked with a dot. A
7/14/30-day toggle re-fetches and redraws. An unauthenticated visit to `/trends` redirects to
`/auth/signin`. A user never sees another user's data (existing RLS). Lint, typecheck, and build pass; the
production Worker bundle stays well under 10 MB (no charting lib added).

### Key Discoveries:

- Stored `gki` at `src/lib/services/biomarkers.ts:52` means trend queries read the index directly — no
  per-row recompute on the read path.
- `getReading` uses `.maybeSingle()`; the range read uses `.select("*").gte("day", from).lte("day", to)
  .order("day")` returning an array — RLS still scopes it to the caller, so no `user_id` filter is needed.
- `biomarker_readings` has `unique (user_id, day)` backing `(user_id, day)` lookups; a bounded date-range
  scan over one user's rows is trivially cheap at MVP scale.
- The daily series is **sparse by nature** (a user may skip days). Charts must map each reading to its
  actual calendar-date x-position and connect across gaps — not assume contiguous days.

## What We're NOT Doing

- **No new table, migration, or RLS change** — reads the existing `biomarker_readings` only.
- **No charting library** — SVG is hand-rolled.
- **No drill-down from chart points** — explicit PRD Non-Goal; date selection/read-back is S-08's job.
- **No diet/activity overlays** — that convergence is S-07; this slice charts biomarkers only.
- **No past-day editing** — the page is strictly read-only.
- **No writes to the biomarker API** — `POST`/`DELETE` are untouched.
- **No test framework** — correctness rests on typecheck/lint/build + a manual walkthrough, matching
  current CI (consistent with S-03).
- **No unit toggles / breath ketones / user-entered GKI** — out of scope, as in S-03.

## Implementation Approach

Bottom-up across three phases, each independently verifiable:

1. **Data layer** — add `listReadings(from, to)` to the service and extend the `GET` route to accept a
   `from`/`to` range (array response) alongside the existing `day` (single-reading) behavior. Verifiable
   with curl before any UI exists.
2. **Page scaffold + routing** — add the protected `/trends` page, register it in `PROTECTED_ROUTES`, and
   wire the dashboard→trends nav link (and a back link). Ship the range toggle and the guided empty state
   here so the page is fully navigable and testable before charts land.
3. **SVG charts** — a small reusable `LineChart` SVG primitive, then the GKI hero chart (with ketosis
   bands) and the combined ketones/glucose dual-axis chart, with connect-across-gaps rendering and dots on
   real points.

RLS makes every read owner-scoped automatically; the range read adds no auth surface. The chart math
(min/max domain, linear scale, SVG path) lives in small pure helpers so it stays testable-by-reading and
reusable by S-07.

## Critical Implementation Details

- **Date-domain x-axis, not index-based.** Points must be positioned by actual `day` (days since the
  window start), so a gap of skipped days shows as a longer flat/sloped segment — not as evenly spaced
  points. Mapping by array index would misrepresent a sparse series. The line connects consecutive
  *readings* (sorted by day); each reading also gets a dot so interpolated stretches are visually distinct
  from real data.
- **Dual-axis honesty.** The combined ketones/glucose chart has two independent linear scales (ketones
  ~0–6 mmol/L on the left, glucose ~20–600 mg/dL on the right). Label both axes and color each line to
  match its axis + legend so the reader never confuses which line reads against which scale.
- **GKI ketosis bands.** Shade the GKI plot background by the widely-cited ranges — roughly `< 1` high
  ketosis, `1–3` moderate, `3–6` low, `> 6` minimal — as SVG background rects behind the line, with a
  compact legend and a "guidance, not medical advice" note. Bands are clamped to the chart's y-domain so
  they never overflow the plot area.
- **Window is computed on the client from `localDay()`.** `to = localDay()`, `from = to − (N−1) days`,
  matching how the existing island derives the browser's local calendar date; the server validates both
  as `daySchema` and enforces `from <= to`.

## Phase 1: Range read — service + API

### Overview

Add a bounded date-range read to the biomarker service and expose it through the existing `GET
/api/biomarkers` route, without disturbing the single-day (`?day=`) behavior the logger depends on.

### Changes Required:

#### 1. Range read in the biomarker service

**File**: `src/lib/services/biomarkers.ts`

**Intent**: Add a `listReadings` function that returns all of the current user's readings within an
inclusive `[from, to]` date range, ordered by day ascending, so the trends island can chart a window. RLS
scopes the query to the caller, mirroring `getReading` (no explicit `user_id` filter).

**Contract**: `listReadings(supabase: SupabaseClient, from: string, to: string): Promise<BiomarkerReading[]>`
— `.from("biomarker_readings").select("*").gte("day", from).lte("day", to).order("day", { ascending: true })`;
throws on error; returns `[]` when no rows. `from`/`to` are ISO `YYYY-MM-DD`.

#### 2. Range branch on the GET route

**File**: `src/pages/api/biomarkers/index.ts`

**Intent**: Extend `GET` so that when `from` and `to` query params are present it returns the range as
`{ readings }`; when only `day` is present it keeps returning `{ reading }` exactly as today. Preserves the
existing single-day contract the logger uses.

**Contract**: Reuse the existing `daySchema` to validate `from` and `to`; add a guard that `from <= to`
(string compare is valid for ISO dates). Precedence: if `from`/`to` are both present → range branch →
`Response.json({ readings })`; else fall back to the current `day` branch. Invalid/missing params → 400,
matching the current shape. Optionally cap the span (e.g. reject ranges wider than ~366 days) to bound the
scan; a 30-day default never hits it.

**Note**: `POST` and `DELETE` are untouched.

#### 3. (If needed) shared response typing

**File**: `src/types.ts`

**Intent**: Only if a named DTO improves clarity — the range response is `BiomarkerReading[]`, which already
exists, so no new type is required unless the island wants a `BiomarkerTrendPoint` alias. Default: reuse
`BiomarkerReading[]`, add nothing.

**Contract**: No change expected; documented here to make the "no new type" decision explicit.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npx tsc --noEmit` (or `npm run build`)
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `GET /api/biomarkers?from=YYYY-MM-DD&to=YYYY-MM-DD` returns `{ readings: [...] }` ordered by day for the
  signed-in user, and `[]` for an empty range.
- `GET /api/biomarkers?day=YYYY-MM-DD` still returns `{ reading }` unchanged (logger unaffected).
- Invalid params (`from > to`, malformed date, missing `to`) return 400; unauthenticated returns 401.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human that the manual testing was successful before proceeding to the next
phase.

---

## Phase 2: `/trends` page, route protection & navigation

### Overview

Create the protected `/trends` page that hosts the trends island, register it for auth protection, and wire
the navigation between dashboard and trends. Ship the range toggle and the guided empty state in this phase
so the page is fully navigable and its non-chart states are verifiable before charts exist.

### Changes Required:

#### 1. New trends page

**File**: `src/pages/trends.astro`

**Intent**: A protected page mirroring `dashboard.astro`'s glass/cosmic layout — header with title, user
email, a "Dashboard" back link, and sign-out — that mounts the `BiomarkerTrends` island `client:load`.

**Contract**: New Astro page; reads `Astro.locals.user`; renders `<BiomarkerTrends client:load />` inside
the standard `max-w-2xl` card. No server-side data fetch (the island fetches its own range on mount).

#### 2. Protect the route

**File**: `src/middleware.ts`

**Intent**: Add `/trends` to `PROTECTED_ROUTES` so an unauthenticated visit redirects to `/auth/signin`.

**Contract**: `PROTECTED_ROUTES = ["/dashboard", "/profile", "/trends"]`.

#### 3. Dashboard → trends nav link

**File**: `src/pages/dashboard.astro`

**Intent**: Add a "Trends" link in the dashboard header next to the existing "Profile" link, using the same
button styling, so users can reach the new page.

**Contract**: An `<a href="/trends">` styled identically to the existing header links.

#### 4. Island shell: range toggle + empty state

**File**: `src/components/biomarkers/BiomarkerTrends.tsx` (new; charts added in Phase 3)

**Intent**: The `client:load` island that computes the window from `localDay()`, fetches
`/api/biomarkers?from=&to=`, manages the 7/14/30-day toggle (default 30) with re-fetch, and renders
loading / error / guided-empty states. Charts are stubbed this phase (a placeholder where they will mount).

**Contract**: Local state `range: 7 | 14 | 30` (default 30), `readings: BiomarkerReading[]`, `loading`,
`error`. On mount and on range change, compute `to = localDay()`, `from = to − (range − 1) days`, fetch,
`AbortController` on unmount (mirroring `BiomarkerLogger`). Empty state (readings length 0) shows a guiding
message + a link to `/dashboard`. `localDay()` is duplicated locally, consistent with the existing islands'
"do NOT extract" note. A small date-subtraction helper computes `from`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Visiting `/trends` while signed out redirects to `/auth/signin`; signed in, the page renders.
- The dashboard header shows a working "Trends" link; the trends page shows a working "Dashboard" back link.
- With no readings in the window, the guided empty state appears with a link to `/dashboard`.
- The 7/14/30 toggle changes selection and triggers a re-fetch (visible in the network tab); default is 30.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human that the manual testing was successful before proceeding to the next
phase.

---

## Phase 3: Hand-rolled SVG charts

### Overview

Replace the Phase-2 placeholder with the real visualizations: a reusable SVG `LineChart` primitive, the GKI
hero chart with ketosis reference bands, and the combined ketones/glucose dual-axis chart — all rendering a
sparse daily series honestly (connect across gaps, dot each real reading).

### Changes Required:

#### 1. Reusable SVG line-chart primitive

**File**: `src/components/biomarkers/LineChart.tsx` (new)

**Intent**: A theme-styled SVG chart that plots one or more date-valued series against a linear y-scale,
positioning points by their calendar date within the window, connecting consecutive readings, and marking
each real point with a dot. Kept generic so the GKI and dual-axis charts (and later S-07) reuse it.

**Contract**: Props roughly `{ from: string; to: string; series: { key: string; color: string; points:
{ day: string; value: number }[]; axis?: "left" | "right" }[]; leftAxis: {label,unit}; rightAxis?:
{label,unit}; bands?: { min: number; max: number; color: string; label: string }[]; height: number }`.
Pure helpers: `dayToX(day, from, to, width)` (fraction of window elapsed), `valueToY(value, domain, height)`
(linear scale, inverted), `buildPath(points)` (SVG `M/L` path over sorted points). Domains derived from the
data with sensible padding; axis ticks and gridlines rendered as SVG. No dependency. A code snippet is
warranted here for the scale/path helpers since other charts depend on their contract:

```ts
// x: position by real date within [from, to]; y: inverted linear scale
const dayToX = (day: string, from: string, to: string, w: number) => {
  const span = daysBetween(from, to) || 1; // avoid /0 for a single-day window
  return (daysBetween(from, day) / span) * w;
};
const valueToY = (v: number, min: number, max: number, h: number) =>
  h - ((v - min) / (max - min || 1)) * h;
```

#### 2. GKI hero chart with ketosis bands

**File**: `src/components/biomarkers/BiomarkerTrends.tsx`

**Intent**: Render a large `LineChart` for the `gki` series with shaded background bands for the standard
ketosis zones and a compact legend + guidance note.

**Contract**: One series (`gki`, from `reading.gki`), `bands` for `<1 / 1–3 / 3–6 / >6` (clamped to the
y-domain), left-axis label "GKI". Values rounded for tooltip/label display via a `round1`-style helper. A
short "orientacyjne zakresy — nie porada medyczna" (guidance, not medical advice) caption in Polish.

#### 3. Combined ketones/glucose dual-axis chart

**File**: `src/components/biomarkers/BiomarkerTrends.tsx`

**Intent**: Render a second `LineChart` with two series on two y-scales — ketones (mmol/L) on the left
axis, glucose (mg/dL) on the right — each color-matched to its axis, with a legend.

**Contract**: `series` = `[{key:"ketones", axis:"left", ...}, {key:"glucose", axis:"right", ...}]`;
`leftAxis={label:"Ketony", unit:"mmol/L"}`, `rightAxis={label:"Glukoza", unit:"mg/dL"}`. Reuses the same
gap-connect + dot rendering.

#### 4. Sparse hint

**File**: `src/components/biomarkers/BiomarkerTrends.tsx`

**Intent**: When charts render but data is thin (e.g. 1–2 points), show a subtle "loguj dalej, aby zobaczyć
trendy" hint above the charts, without blocking the charts.

**Contract**: A conditional caption keyed on `readings.length`; the empty state (length 0) still takes
precedence per Phase 2.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Build passes and the production Worker bundle is produced without adding any charting dependency
  (`package.json` diff shows no new dependency).

#### Manual Verification:

- With several days of readings, the GKI hero chart draws a connected line with dots on real days and shaded
  ketosis bands behind it; values look correct against known readings.
- The ketones/glucose chart shows two correctly-scaled lines with labeled left/right axes and a legend.
- A window containing a skipped day shows a continuous line across the gap with dots only on real readings
  (no phantom dot on the skipped day).
- A single-reading window renders a lone dot without a divide-by-zero or NaN in the SVG path.
- Switching 7/14/30 redraws all charts for the new window; the empty state returns for a window with no data.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

No automated test framework exists in the repo (consistent with S-01–S-05); verification is typecheck +
lint + build plus a manual walkthrough.

### Manual Testing Steps:

1. Sign in; with a fresh account (no biomarker data) open `/trends` → guided empty state with a dashboard link.
2. Log 3–4 biomarker readings across non-consecutive days on `/dashboard`, then open `/trends` → GKI hero
   chart + ketones/glucose chart render; line connects the gap; dots sit only on real days.
3. Toggle 7 / 14 / 30 → charts re-fetch and redraw; default is 30 on load.
4. Confirm ketosis bands sit behind the GKI line and the legend/guidance caption read correctly (Polish).
5. Sign out, hit `/trends` directly → redirect to `/auth/signin`.
6. (Isolation) as a second user, confirm `/trends` shows only that user's data.

## Performance Considerations

- The range read is a single indexed, bounded scan over one user's rows — negligible at MVP scale.
- SVG rendering of ≤ ~90 points per series is trivial; no memoization needed.
- **Bundle:** the deliberate no-charting-lib choice keeps the Worker bundle unchanged, retiring the
  roadmap's flagged 10 MB free-tier watch item. Verify the `package.json` diff adds no dependency.

## Migration Notes

None — no schema change. Reads the existing `biomarker_readings` table and its RLS unchanged.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-06)
- Upstream data slice: `context/changes/biomarker-gki-logging/plan.md` (S-03; stored `gki`, RLS pattern)
- Service to extend: `src/lib/services/biomarkers.ts:23` (`getReading`) → add `listReadings`
- Route to extend: `src/pages/api/biomarkers/index.ts:31` (`GET`, `daySchema`)
- Island pattern: `src/components/biomarkers/BiomarkerLogger.tsx` (`localDay`, fetch/abort, `round1`)
- Routing: `src/middleware.ts:4` (`PROTECTED_ROUTES`), `src/pages/dashboard.astro` (header links, layout)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Range read — service + API

#### Automated

- [x] 1.1 Type checking passes — 57813a2
- [x] 1.2 Linting passes — 57813a2
- [x] 1.3 Build passes — 57813a2

#### Manual

- [x] 1.4 Range GET returns `{ readings }` ordered by day; `[]` for empty range — 57813a2
- [x] 1.5 Single-day GET (`?day=`) still returns `{ reading }` unchanged — 57813a2
- [x] 1.6 Invalid params return 400; unauthenticated returns 401 — 57813a2

### Phase 2: `/trends` page, route protection & navigation

#### Automated

- [x] 2.1 Type checking passes
- [x] 2.2 Linting passes

#### Manual

- [x] 2.3 `/trends` redirects to signin when signed out; renders when signed in
- [x] 2.4 Dashboard "Trends" link and trends "Dashboard" back link both work
- [x] 2.5 Zero-reading window shows the guided empty state with a dashboard link
- [x] 2.6 7/14/30 toggle changes selection and re-fetches; default is 30

### Phase 3: Hand-rolled SVG charts

#### Automated

- [ ] 3.1 Type checking passes
- [ ] 3.2 Linting passes
- [ ] 3.3 Build passes with no new charting dependency in `package.json`

#### Manual

- [ ] 3.4 GKI hero chart draws connected line + dots + ketosis bands; values correct
- [ ] 3.5 Ketones/glucose chart shows two correctly-scaled lines with labeled axes + legend
- [ ] 3.6 Skipped day → continuous line across the gap, dots only on real readings
- [ ] 3.7 Single-reading window renders a lone dot with no NaN/divide-by-zero
- [ ] 3.8 7/14/30 toggle redraws all charts; empty state returns for a no-data window
