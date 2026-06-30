# Biomarker Logging with Automatic GKI (S-03) — Plan Brief

> Full plan: `context/changes/biomarker-gki-logging/plan.md`

## What & Why

Let a keto practitioner log one blood-ketone (mmol/L) + blood-glucose (mg/dL) reading per day and
immediately see the **GKI** the app computes — `GKI = (glucose ÷ 18) ÷ ketones` — calculated
server-side on save (FR-006). GKI is the product's core differentiator; this slice captures the raw
inputs and the derived index, producing the time-series that S-06's trend dashboard will later chart.

## Starting Point

The full vertical-slice template is proven twice: S-01 `meal-macro-logging` (a one-to-many
time-series with a `day` column, a JSON API, and a dashboard React island) and S-02 `health-profile`
(a per-user singleton with a `unique` upsert). Auth, SSR, the RLS migration pattern, and the
`/dashboard` hub are all in place. This slice introduces a new table and reuses both precedents — no
AI call and no new platform risk.

## Desired End State

On `/dashboard`, beneath the meal logger, a Biomarkers section shows today's reading or an empty
form. Entering ketones + glucose and saving shows the computed GKI in place without a full reload;
re-saving overwrites the day's single row; a delete/clear action empties it. Invalid input (ketones
≤ 0, out-of-range, or a missing field) is rejected. A second user never sees another's readings.

## Key Decisions Made

| Decision               | Choice                                                        | Why (1 sentence)                                                            | Source |
| ---------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- | ------ |
| Entry cardinality      | One reading per (user, day), upsert; re-log overwrites       | Simplest one-point-per-day trend story; no downstream aggregation question | Plan   |
| Required fields        | Both ketones AND glucose required → GKI always computed       | Every stored row has a valid GKI; trend charts never have gaps             | Plan   |
| GKI div-by-zero        | Reject ketones ≤ 0 (CHECK `> 0` + Zod `min 0.1`)             | GKI is always a finite real number; no nullable/Infinity plumbing          | Plan   |
| GKI storage            | Stored `gki` column, computed on save                        | Single source of truth; S-06 trend queries read it directly, no per-row math | Plan |
| UI placement           | Dashboard React island, JSON fetch (meals-style)             | Keeps daily logging on the hub; in-place GKI feedback, no reload           | Plan   |
| Delete                 | Yes — a delete/clear action (DELETE route + RLS)             | Lets a user remove a mistaken entry; symmetric with meals                  | Plan   |
| Validation ranges      | Ketones 0.1–20 mmol/L (1 dp), glucose 20–600 mg/dL (int)    | Catches typos without rejecting any legitimate reading                     | Plan   |

## Scope

**In scope:** `biomarker_readings` table (RLS, `unique(user_id, day)`, stored `gki`, CHECK guards);
RLS proof; shared types; `computeGki` + reading service; `GET`/`POST`/`DELETE` JSON API;
`BiomarkerLogger` dashboard island with in-place GKI readout and delete.

**Out of scope:** multiple readings per day; trend charts / history (S-06); past-day read-back (S-08);
breath ketones / unit toggles; user-entered GKI; partial readings; any new page, nav, or middleware
change; a test framework.

## Architecture / Approach

A blend of the two proven precedents: meals' `day date` column + profile's singleton **upsert**, but
the singleton key is `(user_id, day)`. Bottom-up across three layers — (1) migration + RLS proof +
types, (2) a pure `computeGki()` + service + Zod-validated JSON route that computes and stores GKI on
upsert, (3) a `client:load` island on `/dashboard` that fetches today's reading, posts ketones+glucose,
and renders the returned GKI in place. RLS scopes every query to the logged-in user; `user_id` is set
server-side from `context.locals.user.id`.

## Phases at a Glance

| Phase                                   | What it delivers                                              | Key risk                                                  |
| --------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| 1. Foundations (migration, RLS, types)  | `biomarker_readings` table + isolation proof + shared types  | Getting the `(user_id, day)` unique + `ketones > 0` CHECK right |
| 2. Service + JSON API                    | `computeGki` + service + `GET`/`POST`/`DELETE` route         | Upsert must write the computed `gki` + full column set    |
| 3. Dashboard island                      | `BiomarkerLogger` with in-place GKI + delete                 | Mirroring `MealLogger` fetch/error/local-day patterns     |

**Prerequisites:** F-01 (RLS + migration baseline) — done; local Supabase stack running (Docker).
**Estimated effort:** ~3 sessions, one per phase (the meals/profile slices were each ~this size).

## Open Risks & Assumptions

- Assumes the one-per-day model is sufficient for S-06's trends; if intra-day GKI resolution turns out
  to matter, the schema would need to relax to many-per-day (revisit at S-06).
- GKI is stored at full numeric precision and rounded only for display; S-06/S-09 consume the precise
  value.
- No test framework — correctness rests on the SQL RLS recipe + manual walkthrough, matching current CI.

## Success Criteria (Summary)

- A user logs ketones + glucose and immediately sees the correct GKI on the dashboard; re-logging
  overwrites the day, delete clears it.
- Invalid input (ketones ≤ 0, out-of-range, missing field) never persists.
- A second user cannot see another's readings (RLS proof passes); lint, typecheck, and build all pass.
