# Past-Day Read-Only View — Plan Brief

> Full plan: `context/changes/past-day-readonly-view/plan.md`

## What & Why

Roadmap slice **S-08** (PRD FR-011, US-02). Let a signed-in user open a `/history` page, pick a past calendar date, and see that day's meals + macro summary, activity + expenditure, biomarkers + GKI, and wellness parameters — all **read-only**. It closes the daily-tracking loop by letting practitioners look back at any logged day, which the current dashboard (today-only, editable) can't do.

## Starting Point

The dashboard is a today-only *write* surface with four logger islands. Crucially, **every entry type already exposes a single-day read endpoint** (`GET /api/{meals,activities,biomarkers,wellness}?day=YYYY-MM-DD`) returning read-ready shapes. `/trends` is a proven page template, `DailyTotal.tsx` already renders the macro grid, and route protection is one line in `middleware.ts`. So the read plumbing exists.

## Desired End State

From a "History" link in the dashboard header, the user reaches `/history`: a native date picker (bounded to today, defaulting to today) drives four parallel `?day=` fetches; four always-present sections render the day's data read-only, each with a per-type empty state; "Back to dashboard" returns to editing. Unauthenticated access redirects to sign-in.

## Key Decisions Made

| Decision              | Choice                                   | Why (1 sentence)                                                        | Source |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------------------- | ------ |
| Entry point / URL     | New `/history` page, linked from header  | Clean separation from the write dashboard; mirrors the `/trends` pattern. | Plan |
| Date picker           | Native `<input type="date">`, `max`=today | Zero new deps (Worker bundle watch item); past-only bounding for free.  | Plan |
| Data fetch            | Four parallel client calls (`Promise.all`) | Reuses existing endpoints as-is; no backend work.                       | Plan |
| Default date          | Today (rendered read-only)               | User-chosen; picker still allows earlier dates.                         | Plan |
| Empty states          | Per-type (all four sections always show) | Directly satisfies US-02 AC; user sees what was vs. wasn't logged.      | Plan |
| Read-only enforcement | New display-only components + Back link  | Read-only by construction — no write path can exist.                    | Plan |

## Scope

**In scope:** `/history` page, route protection, dashboard nav link, read-only island with native date picker + parallel fetch, four display-only section components, per-type empty states, macro summary reuse.

**Out of scope:** any backend/API/migration change; aggregate `/api/day` endpoint; create/edit/delete on past days; chart drill-down (PRD Non-Goal); CSV/PDF export; day-vs-day comparison; new date-picker dependency; changes to dashboard editing.

## Architecture / Approach

Copy the `/trends` shell → `history.astro`; add `"/history"` to `PROTECTED_ROUTES`; add a header link on the dashboard. One island `DayHistory` owns the selected date (default local today), renders a native date input, and `Promise.all`-fetches the four `?day=` endpoints on every date change (single loading + single error state). Four small display-only components (`DayMeals` reusing `DailyTotal`, `DayActivities`, `DayBiomarkers`, `DayWellness`) render each section with an empty state. All new code lives under `src/pages/history.astro` and `src/components/history/`.

## Phases at a Glance

| Phase                                      | What it delivers                                            | Key risk                                              |
| ------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------- |
| 1. Scaffold, routing & date selection      | Protected `/history`, nav links, date picker, parallel fetch | Local-date computation (avoid UTC off-by-one at midnight) |
| 2. Read-only rendering & empty states       | Four display-only sections + per-type empty states          | Keeping the view mutation-free by construction        |

**Prerequisites:** S-01/S-03/S-04/S-05 all done (they are). Local Supabase with some logged past-day data for manual testing.
**Estimated effort:** ~1–2 sessions across 2 phases; small, no backend.

## Open Risks & Assumptions

- **Local vs UTC date:** the picker default and `max` must come from the browser's local clock (`YYYY-MM-DD`), not `toISOString()`, or a future local date could slip in near midnight. Called out in the plan.
- **Assumption:** the four existing `?day=` endpoints remain the read contract (no aggregate endpoint added).
- No automated test harness exists yet (Module 3 concern); verification is type-check + lint + build + manual UI.

## Success Criteria (Summary)

- User selects a past date and sees that day's meals/macros, activity, biomarkers/GKI, and wellness — read-only.
- Each entry type shows a clear empty state when nothing was logged that day.
- No create/edit/delete is possible from the view; unauthenticated access redirects to sign-in.
