---
change_id: biomarker-gki-logging
title: Biomarker logging with automatic GKI
status: impl_reviewed
created: 2026-06-30
updated: 2026-07-02
archived_at: null
---

## Notes

S-03 from the roadmap. Adds per-day biomarker logging: a user records blood ketones (mmol/L)
and blood glucose (mg/dL) and the app computes GKI = (glucose ÷ 18) ÷ ketones server-side on
save. GKI is never entered directly; units are fixed (FR-006). This slice produces the
time-series that S-06's biomarker trend dashboard will chart.

Builds on the pattern proven by `meal-macro-logging` (S-01) and `health-profile` (S-02): an
RLS table copied from `isolation_canary`, shared DTOs in `src/types.ts`, a Zod-validated API
route, and a `client:load` React island on `/dashboard`. No AI call and no novel platform
risk — GKI is a deterministic pure function. The slice is a blend of the two precedents: it
has meals' `day` column but is a **singleton per (user, day)** (upsert), like profile.

### Decisions locked during planning (2026-06-30)

- **Cardinality:** one reading per calendar day — `unique (user_id, day)`, upserted; re-logging
  the same day overwrites it.
- **Required fields:** both ketones AND glucose are required on every reading, so GKI is always
  computed and stored (no nullable-GKI rows).
- **GKI div-by-zero:** ketones must be `> 0` (CHECK + Zod `min 0.1`); a zero/absent ketone is
  rejected, so GKI is always a finite real number.
- **GKI storage:** stored `gki` column, computed server-side on save (single source of truth for
  S-06 trend queries; no per-row math on read).
- **UI:** a dashboard React island (meals-style, JSON fetch) with in-place GKI feedback — keeps
  all daily logging on the `/dashboard` hub alongside `MealLogger`.
- **Delete:** a delete/clear action removes the day's reading (DELETE route + RLS, like meals).
- **Validation ranges:** ketones 0.1–20 mmol/L (1 decimal), glucose 20–600 mg/dL (integer) —
  catches typos without rejecting any legitimate reading.
