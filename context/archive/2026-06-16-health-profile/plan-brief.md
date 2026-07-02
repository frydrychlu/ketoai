# Health Profile (S-02) — Plan Brief

> Full plan: `context/changes/health-profile/plan.md`

## What & Why

Add a per-user health profile (age, weight, height, activity level, freeform goals) on a dedicated
`/profile` page. US-01 treats a completed profile as a precondition, and S-09's on-demand AI analysis
will later consume it as baseline context. Registration/login already exist — this slice only adds
the profile entity and its edit UI.

## Starting Point

The `meal-macro-logging` slice (S-01) just proved the entire template: a per-user RLS table copied
from `isolation_canary`, shared DTOs in `src/types.ts`, a Zod-validated API route, and a dashboard
island. Auth, the SSR Supabase client, and RLS are all wired. The auth pages
(`SignUpForm.tsx` → `/api/auth/signup`) provide the native-form-POST-and-redirect precedent this
form follows.

## Desired End State

A logged-in user clicks "Profile" on the dashboard, lands on a prefilled `/profile` form, edits any
subset of fields, and saves; the page returns prefilled with a "saved" confirmation. Out-of-range
numbers are rejected server-side. A second user never sees the first user's profile, and `/profile`
redirects to sign-in when logged out.

## Key Decisions Made

| Decision            | Choice                                                        | Why (1 sentence)                                                            | Source |
| ------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- | ------ |
| Body metrics        | Integer `age` + fixed metric (`weight_kg`, `height_cm`)      | Matches PRD wording "age"; no DOB/unit UI for a metric-oriented MVP.        | Plan   |
| Activity level      | Standard 5-level enum (sedentary/light/moderate/very/extra)  | Conventional TDEE ladder — structured baseline the AI can reason over.      | Plan   |
| Health goals        | Single freeform text field                                   | The persona is articulate; AI reads prose fine; lowest entry friction.     | Plan   |
| Profile flow        | Dedicated `/profile` page, no gate                           | Clean separation from the daily-log dashboard; auth/middleware untouched.   | Plan   |
| Required fields     | All optional, partial saves allowed                          | No gating friction; omitted fields stored NULL; matches the app's ethos.   | Plan   |
| Submission          | Native form POST + redirect (auth-style), Zod-validated route | Reuses auth form primitives; a profile needs no live in-place update.       | Plan   |
| Validation          | Zod with sane range bounds                                   | Catches typos (e.g. 700 kg) that would poison the AI baseline.             | Plan   |
| Singleton storage   | `unique (user_id)` + `.upsert(onConflict: "user_id")`        | One profile row per user — the only structural delta from the `meals` table. | Plan   |

## Scope

**In scope:** `health_profiles` migration (singleton + range/enum CHECKs + RLS), RLS isolation proof,
shared types, profile service, Zod-validated `POST /api/profile` upsert, `/profile` page, `ProfileForm`
island, dashboard link, route protection.

**Out of scope:** DOB/computed age, imperial units, structured/multi-select goals, required-field
gating or forced onboarding, profile delete, any feature consuming the profile (S-09), new test
framework, changes to meals or auth routes.

## Architecture / Approach

Bottom-up, mirroring S-01. **Data:** a singleton `health_profiles` table (nullable columns, CHECK
range/enum guards, four RLS policies, `unique(user_id)`). **Server:** a `profile.ts` service
(`getProfile` / `upsertProfile`) and a `POST /api/profile` route that coerces the native-form payload,
validates with Zod, upserts the caller's row, and redirects. **UI:** `/profile.astro` SSR-reads the
row to prefill a `ProfileForm` island (built from the auth `FormField`/`SubmitButton`/`ServerError`
primitives), reachable from a dashboard link; `/profile` is added to `PROTECTED_ROUTES`. The SSR page
reads the profile directly, so no `GET` endpoint is needed.

## Phases at a Glance

| Phase                                         | What it delivers                                          | Key risk                                                       |
| --------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Foundations                                | Singleton RLS table + isolation proof + shared types      | Getting nullable-column + CHECK guards to coexist with partial saves |
| 2. Service + API                              | `profile.ts` + Zod-validated upsert route                 | formData→nullable/number coercion before validation           |
| 3. UI                                         | `/profile` page, form island, dashboard link, protection  | Reusing auth primitives cleanly; prefill + saved/error flash  |

**Prerequisites:** F-01 (done — RLS pattern + migration workflow proven); local Supabase stack running.
**Estimated effort:** ~1–2 sessions across 3 phases (no AI, no novel risk — pure CRUD on a proven template).

## Open Risks & Assumptions

- The activity-enum values are fixed in three places (DB CHECK, Zod enum, form options) — keep them
  sourced from the `ACTIVITY_LEVELS` tuple to avoid drift.
- Range bounds (age 13–120, weight 20–500 kg, height 50–250 cm) are MVP-reasonable guesses; easy to
  loosen later via a new migration if a real user hits a wall.
- Assumes the profile stays write-only for now; S-09 will define how AI reads it (must tolerate NULLs).

## Success Criteria (Summary)

- A user can create, edit, and partially save their profile on `/profile`, with values prefilled on return.
- Out-of-range input is rejected server-side and never persisted; the profile is a single row per user.
- One user's profile is never visible to another (proven by the copied RLS SQL recipe).
