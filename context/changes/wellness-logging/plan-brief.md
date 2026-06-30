# Daily Wellness Parameters Logging (S-05) — Plan Brief

> Full plan: `context/changes/wellness-logging/plan.md`

## What & Why

Let a logged-in user record their daily wellness parameters — mood, energy, and sleep quality (1–10
ratings), water intake (liters), and freeform notes — for the day (PRD FR-007). It's the simplest
logging slice: a singleton-per-day record, no AI, no computed field. The freeform notes field is also
the context S-09's on-demand AI analysis can later draw on.

## Starting Point

Four logging slices are already done (meals, profile, biomarkers, activity), so the table + RLS +
service + JSON API + dashboard-island pattern is proven four times over. S-03 `biomarker_readings` is
the near-exact template (singleton per user/day); S-02 `health_profiles` is the template for
all-nullable partial-save fields. `/dashboard` is already auth-protected and hosts three islands today.

## Desired End State

On `/dashboard`, a "Wellness" section (fourth island) shows today's entry or an empty form. The user
fills any subset of the five fields and saves; values appear in place without a reload. Re-saving
overwrites the day's single row; blanking a field clears it to `null`; a clear action deletes the
day's entry. Out-of-range values and fully-empty submits are rejected inline. Entries are strictly
per-user (RLS-isolated).

## Key Decisions Made

| Decision            | Choice                                            | Why (1 sentence)                                                        | Source |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| Field set           | Exactly the roadmap's five                        | Matches FR-007; notes absorbs anything else (no biometeo column)        | Plan   |
| Rating scale        | 1–10 integer (mood, energy, sleep)                | Finer granularity than 1–5, simple integer CHECK, chartable later       | Plan   |
| Water unit          | Liters, `numeric` (1 decimal)                     | Natural metric unit; easy CHECK; correlates cleanly in later analysis   | Plan   |
| Optionality         | All fields nullable, partial save                 | Wellness params are inherently optional; health-profile precedent       | Plan   |
| Empty-submit guard  | Reject all-null body (Zod `.refine`)              | Avoid meaningless empty rows; clearing the day is the DELETE path        | Plan   |
| Rating input        | Number inputs (1–10)                              | Cleanly represents "not set" → null; reuses BiomarkerLogger inputs       | Plan   |
| Cardinality / UI    | Singleton per (user, day); dashboard island       | Mirrors S-03 verbatim — upsert on `unique (user_id, day)`               | Plan   |

## Scope

**In scope:** `wellness_entries` table (singleton/day, nullable fields, range CHECKs), RLS proof,
shared types, service (read/upsert/delete), `GET`/`POST`/`DELETE` JSON API with an at-least-one-field
guard, `WellnessLogger` dashboard island.

**Out of scope:** AI/estimator, any computed field, biometeorological column, required fields, multiple
entries per day, trend charts/history (S-06/S-07), past-day read-back (S-08), edit of a past day, new
page/route, middleware change, new test framework.

## Architecture / Approach

Bottom-up in three independently-committed phases, copying S-03's singleton-per-day slice: data + types
→ service + Zod-validated JSON route → React island on `/dashboard`. The only structural twist vs S-03
is all-nullable fields with an explicit-null upsert (health-profile style) plus an at-least-one-field
Zod guard. RLS isolation enforced purely by the four per-operation policies keyed on `auth.uid() =
user_id`.

## Phases at a Glance

| Phase                          | What it delivers                                       | Key risk                                                        |
| ------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------- |
| 1. Foundations                 | Migration + RLS proof + shared types                   | CHECKs must tolerate NULL; new file must sort after 20260630120001 |
| 2. Service + API route         | read/upsert/delete + `GET`/`POST`/`DELETE` JSON        | Explicit-null upsert (not partial spread); at-least-one guard at Zod layer |
| 3. UI — WellnessLogger island  | Dashboard island with partial-save + clear             | Blank input → `null` mapping; empty-submit guard parity with server |

**Prerequisites:** F-01 (done — RLS + migration workflow); local Supabase stack running in Docker.
**Estimated effort:** ~1 session across 3 phases (simplest slice; no AI, no computed field).

## Open Risks & Assumptions

- Assumes the explicit-null upsert correctly clears blanked fields (validated in Phase 2 manual step) —
  the known PostgREST `undefined`-is-skipped gotcha is handled by listing every column explicitly.
- Assumes a 1–10 scale is enough resolution for later S-06/S-07 wellness trend visualizations.

## Success Criteria (Summary)

- A user can save any subset of the five wellness fields for today and see them in place; re-saving
  overwrites the day's single row and clears blanked fields.
- Out-of-range values and fully-empty submits are rejected; a clear action removes the day's entry.
- A second user never sees the first user's wellness entries (RLS proof passes); lint + build pass.
