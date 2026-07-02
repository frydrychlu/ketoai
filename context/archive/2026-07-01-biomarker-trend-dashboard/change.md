---
change_id: biomarker-trend-dashboard
title: Biomarker trend dashboard
status: archived
created: 2026-07-01
updated: 2026-07-02
archived_at: 2026-07-02T06:01:53Z
---

## Notes

S-06 from the roadmap. A read-only `/trends` page that charts GKI, ketones, and glucose over a
selectable window (7 / 14 / 30 days, default 30), reading the `biomarker_readings` time-series that
S-03 (`biomarker-gki-logging`) already produces (FR-009, US-01). No new table, no writes, no RLS
change — the slice adds a range read, a new protected page, and hand-rolled SVG charts.

Builds on the read/island patterns proven by `biomarker-gki-logging` (S-03) and `meal-macro-logging`
(S-01): a Zod-validated JSON route, shared DTOs in `src/types.ts`, and a `client:load` React island.
The one novel element is charting — deliberately hand-rolled in SVG to retire the roadmap's flagged
Cloudflare Workers 10 MB bundle-size watch item at zero dependency cost.

### Decisions locked during planning (2026-07-01)

- **Charting:** hand-rolled SVG line charts (no charting dependency) — zero bundle cost, retires the
  10 MB Worker limit risk outright; full control over the glass/cosmic theme.
- **Placement:** a new protected `/trends` page (not a section on `/dashboard`) — keeps the daily-log
  hub uncluttered and gives S-07's correlation charts a home. Adds `/trends` to `PROTECTED_ROUTES`
  and a nav link from the dashboard header.
- **Chart layout:** a large **GKI hero chart** with ketosis reference bands on top, and a **combined
  ketones/glucose dual-axis chart** below.
- **Time range:** selectable 7 / 14 / 30 days via a toggle, default 30; each change re-fetches the range.
- **Empty state:** the guided empty state (CTA to log on `/dashboard`) shows only when the window has
  **zero** readings; charts render from 1+ points, with a subtle "keep logging" hint while sparse.
- **Gaps (missing days):** connect the line continuously across skipped days and render a visible dot on
  each real reading; the x-axis is plotted by actual date so gaps read honestly.
- **GKI zones:** subtle shaded background bands for the standard GKI ketosis ranges (guidance, not
  medical advice), with a small legend.
