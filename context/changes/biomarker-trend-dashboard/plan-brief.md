# Biomarker Trend Dashboard (S-06) — Plan Brief

> Full plan: `context/changes/biomarker-trend-dashboard/plan.md`

## What & Why

Give a keto practitioner a read-only `/trends` page that charts their GKI, ketone, and glucose history
over time (FR-009, US-01). S-03 already logs one reading per day with a stored GKI; this slice turns that
accumulating time-series into the visual payoff — seeing whether you're trending into or out of ketosis —
and is the prerequisite for S-07's diet/activity correlation charts.

## Starting Point

`biomarker_readings` (S-03) already stores `ketones_mmol_l`, `glucose_mg_dl`, and a server-computed `gki`
per `(user_id, day)`, RLS-scoped to the owner — exactly the series to chart. The service reads only a
single day today (`getReading`), the `GET /api/biomarkers` route accepts only `?day=`, and there is **no
charting library** in `package.json`. Auth, SSR, the island pattern (`BiomarkerLogger`), and the
`PROTECTED_ROUTES` mechanism are all in place.

## Desired End State

Signed in, a user opens `/trends` (linked from the dashboard). A large GKI line chart with shaded ketosis
zones sits on top; below it, a combined ketones/glucose chart on two y-axes. Lines connect across days with
no reading, with a dot on each real reading. A 7/14/30-day toggle (default 30) re-fetches and redraws. With
no data in the window, a guided empty state points them back to the dashboard to log. Unauthenticated
visits redirect to signin; users only ever see their own data.

## Key Decisions Made

| Decision              | Choice                                                         | Why (1 sentence)                                                        | Source |
| --------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| Charting              | Hand-rolled SVG (no library)                                  | Zero bundle cost retires the roadmap's flagged 10 MB Worker limit risk | Plan   |
| Placement             | New protected `/trends` page                                  | Keeps the daily-log hub uncluttered; gives S-07 correlation a home     | Plan   |
| Chart layout          | GKI hero chart + combined ketones/glucose dual-axis chart     | Distinct scales read clearly; GKI is the product's hero metric         | Plan   |
| Time range            | Selectable 7 / 14 / 30 days, default 30                       | 30 covers the 2-week+ success horizon; toggle is cheap state + re-fetch| Plan   |
| Empty state           | Guided empty only at 0 readings; charts from 1+               | Simple rule; shows progress early without a fuzzy threshold            | Plan   |
| Missing days          | Connect line across gaps, dot each real reading               | Keeps the trend readable when logging is irregular; dots stay honest   | Plan   |
| GKI zones             | Subtle shaded ketosis bands + "guidance, not medical" note    | Turns an abstract GKI number into meaning — the core value             | Plan   |

## Scope

**In scope:** `listReadings(from, to)` service read; a `?from=&to=` range branch on `GET /api/biomarkers`;
a protected `/trends` page + `PROTECTED_ROUTES` entry + dashboard nav link; a reusable SVG `LineChart`; the
GKI hero chart (with ketosis bands) and combined ketones/glucose dual-axis chart; range toggle; guided
empty + sparse states.

**Out of scope:** any new table/migration/RLS change; a charting library; chart drill-down (S-08);
diet/activity overlays (S-07); past-day editing; writes to the biomarker API; a test framework; unit
toggles / breath ketones / user-entered GKI.

## Architecture / Approach

Bottom-up, three layers. (1) Service gains a bounded date-range read; the `GET` route gains a `from`/`to`
branch returning `{ readings }` while `?day=` keeps returning `{ reading }`. (2) A protected `/trends`
Astro page mounts a `client:load` `BiomarkerTrends` island that computes its window from `localDay()`,
fetches the range, and owns the toggle + empty/loading/error states. (3) A pure-helper SVG `LineChart`
(date→x, value→y, path builder) renders the GKI hero chart and the dual-axis ketones/glucose chart. RLS
makes every read owner-scoped automatically.

## Phases at a Glance

| Phase                          | What it delivers                                            | Key risk                                                   |
| ------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------- |
| 1. Range read (service + API)  | `listReadings` + `?from=&to=` GET branch                   | Not breaking the existing `?day=` single-reading contract  |
| 2. Page + routing + shell      | Protected `/trends`, nav links, toggle + empty state       | Wiring `PROTECTED_ROUTES` and the client window math right  |
| 3. SVG charts                  | Reusable `LineChart`, GKI hero + dual-axis chart           | Honest sparse-series rendering; dual-axis clarity; no NaN   |

**Prerequisites:** S-03 (`biomarker-gki-logging`) — done; local Supabase stack (Docker) for manual testing.
**Estimated effort:** ~3 sessions, one per phase (Phase 3 is the heaviest — hand-rolled chart math).

## Open Risks & Assumptions

- Assumes S-03's one-reading-per-day model is the intended resolution for trends (matches S-03's own note).
- Ketosis band thresholds are widely-cited guidance, labeled as such — not clinical advice.
- Single-day / single-point windows must not divide by zero in the date→x scale (guarded in the plan).
- No automated tests — correctness rests on typecheck/lint/build + the manual walkthrough, as in S-01–S-05.

## Success Criteria (Summary)

- A user with logged readings sees correct, readable GKI / ketone / glucose trends over their chosen window,
  with ketosis context on the GKI chart.
- A user with no data in the window is guided to log; the 7/14/30 toggle re-scopes the view.
- The production build adds no charting dependency (bundle risk retired); lint, typecheck, and build pass.
