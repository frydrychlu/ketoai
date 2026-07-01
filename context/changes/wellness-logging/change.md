---
change_id: wellness-logging
title: Daily wellness parameters logging
status: implemented
created: 2026-06-30
updated: 2026-07-01
archived_at: null
---

## Notes

S-05 from the roadmap. Adds per-day wellness logging: a user records mood, energy level, and
sleep quality (each a 1–10 self-rating), water intake (liters), and a freeform notes field for
the day (FR-007). One entry per calendar day — a singleton per (user, day), upserted on re-log.

Builds on the pattern proven by `meal-macro-logging` (S-01), `health-profile` (S-02),
`biomarker-gki-logging` (S-03), and `activity-logging` (S-04): an RLS table copied from
`isolation_canary`, shared DTOs in `src/types.ts`, a Zod-validated API route, and a `client:load`
React island on `/dashboard`. No AI call, no computed field, no novel platform risk — the simplest
slice. It is a blend of two precedents: biomarker's **singleton-per-(user, day)** cardinality and
health-profile's **all-nullable partial-save** fields. The freeform notes field is the context the
S-09 AI analysis can later reference.

### Decisions locked during planning (2026-06-30)

- **Fields (exactly the roadmap's five):** `mood`, `energy`, `sleep_quality` (1–10 integers),
  `water_liters` (numeric, 1 decimal), `notes` (freeform text). No structured biometeorological
  field — that prose goes in `notes` (PRD FR-007 narrowed to these five).
- **Cardinality:** one entry per calendar day — `unique (user_id, day)`, upserted; re-logging the
  same day overwrites it (biomarker precedent).
- **Optionality:** every field is nullable; partial save is allowed (health-profile precedent). A
  cleared field is sent as explicit `null` so the upsert NULLs that column on the conflict-UPDATE
  path. A **fully-empty** submit (all five fields null/blank) is rejected — no meaningless empty rows.
- **Rating scale:** subjective ratings are integers 1–10 (DB CHECK `between 1 and 10`).
- **Water unit:** liters as `numeric` (1-decimal display), DB CHECK `>= 0 and <= 20`.
- **UI:** a dashboard React island (biomarker-style, JSON fetch) with in-place feedback and a
  clear action — keeps all daily logging on the `/dashboard` hub.
- **Delete:** a clear action removes the day's entry (DELETE route + RLS, like biomarker).
