# Diet & Activity Correlation Visualizations (S-07) — Plan Brief

> Full plan: `context/changes/diet-activity-correlation/plan.md`

## What & Why

Extend the existing `/trends` page so a keto practitioner can see their biomarker trends **against** their diet
(macros) and activity over the same time window (FR-010). This is the "visual payoff" of the product's core
bet — letting the user eyeball whether a carb spike or a lazy day lines up with their GKI drifting out of
ketosis.

## Starting Point

S-06 already ships `/trends` with a GKI line chart and a ketones/glucose chart, driven by a 7/14/30-day window
toggle in the `BiomarkerTrends` island, plus a reusable hand-rolled SVG `LineChart` (built with S-07 reuse in
mind). Biomarkers already have a `?from=&to=` range read; **meals and activities only have single-day reads** —
that's the main gap this slice fills.

## Desired End State

At `/trends`, below the two biomarker charts, two new **date-aligned bar charts** appear under the same window
toggle: a **stacked fat/protein/carbs** diet chart and an **activity kcal-burned** chart. All charts share one
date x-axis so columns line up vertically for correlation-by-eye. Each new chart has its own guided empty state
(partial data is common), and everything stays RLS-scoped and read-only.

## Key Decisions Made

| Decision                         | Choice                                              | Why (1 sentence)                                                                 | Source |
| -------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| Visualization layout             | Aligned small-multiples (stacked, shared x-axis)    | Cleanest correlation read; each metric keeps an honest scale; reuses `LineChart`. | Plan   |
| Chart type for diet/activity     | Bars (new hand-rolled `BarChart` primitive)         | Bars honestly represent discrete per-day amounts; lines would imply continuity.   | Plan   |
| Diet metrics shown               | Full macro split (fat/protein/carbs) as stacked bars | User wants the whole composition, with carbs findable as a slice.                 | Plan   |
| Activity metric                  | Daily estimated kcal burned                         | The one activity number logged; it's the "activity" half of the slice.            | Plan   |
| Day alignment                    | Same-day columns (no shift)                         | Truthful — what's shown matches what's stored; no hidden off-by-one.               | Plan   |
| Empty-state handling             | Per-chart empty states                              | Streams fill independently; a missing activity log shouldn't blank the GKI trend.  | Plan   |
| Placement                        | Extend the existing `/trends` island & window        | All trends in one place under one date range; reuses fetch/window logic.           | Plan   |
| Chart-point drill-down / popups  | Excluded                                            | Explicit PRD & roadmap Non-Goal (date read-back is S-08 via a calendar control).   | Roadmap |

## Scope

**In scope:** JS-aggregated daily range reads for meals + activities (service + `?from=&to=` API branch); a
hand-rolled SVG `BarChart` (stacked + single-series); two new date-aligned charts in the trends island with
per-chart empty states; new series DTO types.

**Out of scope:** chart-click drill-down / popups; any new table, migration, or RLS change; a charting library;
day-shifting the diet/activity data; computed correlation statistics; changes to the biomarker charts or any
writes; a new page or second window toggle.

## Architecture / Approach

Bottom-up, three phases: **(1)** add `listDailyTotals`/`listDailyExpenditure` to the meals/activities services
(reusing the existing pure `sumDaily*` helpers) and a `?from=&to=` GET branch copied from the biomarkers route;
**(2)** build the `BarChart` primitive that positions bars on the **same date x-domain and padding as
`LineChart`** so columns align; **(3)** wire both new charts into `BiomarkerTrends.tsx`, fetching all three
ranges on the shared window. RLS keeps every read owner-scoped.

## Phases at a Glance

| Phase                         | What it delivers                                             | Key risk                                                        |
| ----------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Range reads (data layer)   | `?from=&to=` daily-aggregated meals + activities series      | Aggregation correctness; not breaking the single-day loggers.  |
| 2. `BarChart` primitive       | Hand-rolled stacked/single-series SVG bar chart              | Column alignment with `LineChart`; sparse days as gaps not zeros. |
| 3. Correlation charts         | Two date-aligned charts in the island + per-chart empties    | Three parallel fetches; partial-data UX; visual alignment.     |

**Prerequisites:** S-06, S-01, S-04 — all done. Local Supabase with some logged meals/activities/biomarkers to
verify charts (seed script covers biomarkers).
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Column alignment between the new `BarChart` and the existing `LineChart` depends on matching window + padding
  + `dayToX` math; if they drift, the small-multiples correlation breaks (called out as the load-bearing detail).
- Assumes JS aggregation over a bounded range scan is fine at MVP scale (it is; PostgREST has no easy GROUP BY).
- Bar width scales with window size (thin at 30 days); assumed acceptable for the fixed 640-wide SVG.

## Success Criteria (Summary)

- A user with logged data sees biomarker trends plus date-aligned diet (stacked macros) and activity (kcal)
  charts, columns lining up for eyeball correlation.
- Missing a stream shows that chart's own empty state without blanking the others; switching the window redraws
  everything in alignment.
- No new dependency, no schema change; lint/typecheck/build pass and RLS keeps data owner-scoped.
