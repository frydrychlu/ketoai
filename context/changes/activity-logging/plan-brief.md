# Physical Activity Logging with Estimated Calories (S-04) — Plan Brief

> Full plan: `context/changes/activity-logging/plan.md`

## What & Why

Let a keto practitioner log a physical activity in free text and immediately see an approximate
caloric expenditure the app estimates via an LLM (FR-005). Today's activities sum into a daily
expenditure total. This produces the activity-burn series that S-07's diet/activity correlation will
later consume, and it gives the daily "did I move today?" signal the PRD's aggregation theme calls for.

## Starting Point

The full vertical slice is proven by S-01 `meal-macro-logging`: a per-user RLS table with a `day`
column, a Zod-validated `GET`/`POST`/`DELETE` JSON API, a `client:load` fetch island with a daily
total, and — critically — a self-contained OpenRouter boundary (`macros.ts` + `macro-schema.ts`,
structured-JSON + Zod + retry-once-then-reject). S-02 (profile) and S-03 (biomarkers) reuse the same
table/RLS/island shape. Auth, SSR, RLS, and `OPENROUTER_API_KEY` are all wired. No new platform risk.

## Desired End State

On `/dashboard`, a third "Activity" island (below meals and biomarkers) shows today's activities and a
headline daily expenditure total. Typing "45 min rower" and submitting calls the LLM, saves the
activity with an approximate calorie estimate, appends it to the list, and updates the total — no full
reload. Each row has a delete that recomputes the total. A failed estimate shows an inline error and
saves nothing. A second user never sees another's activities.

## Key Decisions Made

| Decision              | Choice                                                       | Why (1 sentence)                                                                 | Source |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| Estimator input       | Free-text description only                                  | Mirrors meals; keeps S-04 independent of S-02 (roadmap prereq = F-01); no null-weight edge | Plan |
| Manual override       | None — AI estimate stored as-is, labeled approximate         | Consistent with un-edited meal macros; one source of truth, simplest flow        | Plan   |
| Form shape            | Single free-text field (duration in the prose)              | Identical UX to MealLogger; least code; model infers duration from text          | Plan   |
| Estimate-failure      | Reject the entry (inline error, persist nothing)            | Mirrors a failed meal parse; every stored activity has a real estimate           | Plan   |
| Daily total           | Yes — today's-expenditure sum (like meals' DailyTotal)       | Matches the meals pattern and the daily-aggregation theme; feeds S-07            | Plan   |
| UI placement          | Third dashboard island (meals + biomarkers + activity)      | One daily-log hub; identical UX to MealLogger                                     | Plan   |
| Delete                | Per-activity delete (mirror meals `[id].ts`)                | Lets a user fix a mis-logged/duplicate entry; recomputes the total              | Plan   |
| Cardinality           | Many activities per day (no unique constraint)              | Activities are inherently multiple per day — like meals, unlike S-03 biomarkers  | Plan   |

## Scope

**In scope:** `activities` table (RLS, `(user_id, day)` index, `description` + `calories_kcal` + `day`);
RLS proof; shared types; an OpenRouter activity-calorie estimator (a `macros.ts` twin, one-number
output); `GET`/`POST`/`DELETE` JSON API; an `ActivityLogger` dashboard island with a daily expenditure
total and per-row delete.

**Out of scope:** body-weight/profile coupling; manual override; structured duration/intensity fields;
nullable/zero-calorie activities; net-energy (intake−expenditure) math (S-07); trend charts (S-06/S-07);
past-day read-back (S-08); any new page, nav, or middleware change; a test framework.

## Architecture / Approach

Meals, almost verbatim, with the macro AI swapped for a one-number calorie estimator. Bottom-up across
three layers — (1) migration (copied from `meals` minus the three macro columns) + RLS proof + types,
(2) the estimator (`activity-estimate.ts` + `-schema.ts` twins of `macros.ts`/`macro-schema.ts`) +
activities service (insert + daily sum) + `GET`/`POST`/`DELETE` route, (3) a `client:load`
`ActivityLogger` island mounted as the third island on `/dashboard`. RLS scopes every query to the
logged-in user; `user_id` and the calorie estimate are set server-side.

## Phases at a Glance

| Phase                                   | What it delivers                                                  | Key risk                                                     |
| --------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| 1. Foundations (migration, RLS, types)  | `activities` table + isolation proof + shared types               | Trivial — copy meals minus macros; keep it many-per-day (no unique) |
| 2. Estimator + service + JSON API        | OpenRouter one-number estimator + service + `GET`/`POST`/`DELETE` | Faithfully reusing the retry-once-reject AI boundary + 422 mapping |
| 3. Dashboard island                      | `ActivityLogger` with daily total + per-row delete                | Third island layout; labeling estimates as approximate      |

**Prerequisites:** F-01 (RLS + migration baseline) — done; local Supabase running; a live `OPENROUTER_API_KEY`.
**Estimated effort:** ~3 sessions, one per phase (matches the S-01/S-03 slice size).

## Open Risks & Assumptions

- Free-text-only estimates are rough (no body weight); acceptable because the PRD labels them
  approximate, but accuracy depends on how the user describes duration.
- Reuses the exact OpenRouter model/endpoint already proven for meals; a model-slug change would affect
  both estimators (model lives in one place per service).
- No test framework — correctness rests on the SQL RLS recipe + manual walkthrough, matching current CI.

## Success Criteria (Summary)

- A user logs an activity in text and immediately sees an approximate calorie estimate; today's
  activities sum into a daily expenditure total; delete recomputes it.
- A failed estimate or empty input never persists an activity.
- A second user cannot see another's activities (RLS proof passes); lint, typecheck, and build all pass.
