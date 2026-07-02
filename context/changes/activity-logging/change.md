---
change_id: activity-logging
title: Physical activity logging with estimated calories
status: impl_reviewed
created: 2026-06-30
updated: 2026-07-02
archived_at: null
---

## Notes

S-04 from the roadmap. A user logs a physical activity by describing it in free text and sees an
approximate caloric expenditure estimate (FR-005). Per the roadmap this **reuses the AI-request
boundary proven and de-risked in S-01** (`meal-macro-logging`): a synchronous OpenRouter call with
structured-JSON output + Zod validation + retry-once-then-reject. The estimator returns one number
(calories) rather than the four meal macros; everything else is the meals slice almost verbatim.

Activities are a **one-to-many time-series like meals** (multiple per day, each its own row with a
`day` column), not a per-day singleton like S-03 biomarkers. The slice adds an `activities` table on
the proven RLS pattern, an activity estimator service, a `GET`/`POST`/`DELETE` JSON API, and a third
`client:load` island on `/dashboard` with a daily expenditure total.

### Decisions locked during planning (2026-06-30)

- **Estimator input:** free-text description only — mirrors the meals macro pattern; keeps S-04
  independent of S-02 (roadmap prerequisites = F-01 only) and avoids the nullable-weight edge case.
- **No manual override:** the AI estimate is stored as-is and labeled approximate (like un-edited meal
  macros); to change it the user deletes and re-describes.
- **Form shape:** a single free-text field — duration/intensity live in the prose ("45 min rower");
  no separate structured duration/intensity inputs.
- **Estimate-failure handling:** reject the entry (inline error, persist nothing) exactly like a failed
  meal parse — every stored activity has a real estimate, keeping the daily total trustworthy.
- **Daily total:** show a today's-expenditure total (sum of today's activity calories), like meals'
  `DailyTotal`.
- **UI placement:** a third dashboard island alongside meals and biomarkers (single daily-log hub).
- **Delete:** per-activity delete (mirror meals `[id].ts`); recomputes the daily total.
