---
change_id: health-profile
title: Health profile
status: impl_reviewed
created: 2026-06-16
updated: 2026-07-02
archived_at: null
---

## Notes

S-02 from the roadmap. Adds the per-user health profile (age, weight, height, activity
level, health goals) that US-01 treats as a precondition ("a logged-in practitioner who has
completed my health profile") and that S-09's on-demand AI analysis later consumes as baseline
context. Registration/login (FR-001/FR-002) are already implemented; this slice only adds the
profile entity + edit UI.

Builds directly on the pattern proven by `meal-macro-logging` (S-01): RLS table copied from
`isolation_canary`, shared DTOs in `src/types.ts`, a Zod-validated API route, and a `/profile`
page. No AI and no novel platform risk — the one design wrinkle is that a profile is a
**singleton per user** (upsert), not a growing collection.

### Decisions locked during planning (2026-06-16)

- **Body metrics:** integer `age` + fixed metric units (`weight_kg`, `height_cm`); no DOB, no unit toggle.
- **Activity level:** standard 5-level enum — `sedentary` / `light` / `moderate` / `very` / `extra`.
- **Health goals:** single freeform text field.
- **Profile flow:** dedicated `/profile` page reachable from `/dashboard`; NOT a forced gate (auth/middleware flow untouched beyond adding `/profile` to `PROTECTED_ROUTES`).
- **Required fields:** all optional — partial saves allowed; omitted fields stored as NULL.
- **Submission:** native form POST (auth-style) to a Zod-validated `/api/profile` route that upserts on `user_id`, then redirects back to `/profile`; SSR page prefills from the existing row.
- **Validation:** Zod with sane range bounds (age 13–120, weight 20–500 kg, height 50–250 cm, activity ∈ enum).
