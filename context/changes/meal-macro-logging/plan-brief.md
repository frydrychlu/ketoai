# Meal Macro Logging (S-01) — Plan Brief

> Full plan: `context/changes/meal-macro-logging/plan.md`

## What & Why

The roadmap north star: a user types a meal in plain Polish on `/dashboard`, the app calls OpenRouter **from inside the Cloudflare Worker** to parse it into macros, persists it per-user under RLS, and the day's total updates in place. This proves the core differentiator (AI macro parsing) end-to-end and retires the project's single riskiest unknown — the first LLM call from a Worker.

## Starting Point

Auth + SSR are fully wired (`middleware.ts`, `src/lib/supabase.ts`); the per-user RLS pattern is proven by the `isolation_canary` table; local Supabase (Docker) now runs. But `zod` isn't installed, `src/types.ts` doesn't exist, the dashboard is a placeholder, OpenRouter is only an env-schema entry with no client code, and there's no test framework.

## Desired End State

On `/dashboard`, a signed-in user logs a meal, sees a few-second pending state, then the meal + updated fat/protein/carbs/kcal total appear without a reload. They can delete a mis-parsed meal (total drops). Unparseable input shows an inline error and persists nothing. A second user never sees the first's meals.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| AI request mode | Sync JSON to OpenRouter, await full response | Macros are ~4 numbers; avoids Workers streaming footgun | Change.md |
| Output contract | `response_format` json_schema + Zod validate | Bad output caught at the boundary, never persisted | Change.md |
| Parse failure | Retry once, then 422 + inline error, persist nothing | Keeps the daily total trustworthy; no silent draft | Change.md |
| Calories | Trust & store the LLM's calorie number | User decision | Plan |
| Carbs | Single total-carbs field (no fiber/net) | Matches PRD FR-004 wording; simplest schema | Plan |
| Meal schema | raw text + macros + `logged_at` + `day` | Raw text enables later AI-analysis context; `day` makes aggregation a cheap indexed filter | Plan |
| Day boundary | Browser sends its local `YYYY-MM-DD` | Correct local-day grouping with no profile dependency | Plan |
| Mutability | Add + delete (no edit) | Recovery path for bad parses, scope stays tight | Plan |
| Model / language | Polish input; mid-tier structured-output Claude via OpenRouter | Persona is Polish; mid-tier handles Polish + guarantees JSON schema | Plan |
| UI placement | Built into `/dashboard` | US-01 ties the daily total to the dashboard | Plan |
| Update flow | React island: client `fetch` + pending + in-place update | Matches "immediately see total update" + the sync JSON API | Plan |
| Verification | lint/build/typecheck + copied SQL RLS proof + manual | Matches current CI reality; no new deps on the riskiest slice | Plan |

## Scope

**In scope:** `meals` table + RLS + isolation proof; `zod`; `src/types.ts`; OpenRouter macro service; `POST`/`DELETE` JSON API; `/dashboard` meal logger with today's total.

**Out of scope:** meal edit/re-parse; net-carb/fiber; per-meal breakdown in UI; trend charts; past-day view; other logging types; AI analysis; new test framework; profile timezone.

## Architecture / Approach

Bottom-up to prove the risk early: **(1)** data + types foundation → **(2)** isolate and prove the OpenRouter-from-Worker call as a standalone service (the spike) → **(3)** wrap it in Zod-validated JSON routes that persist via the RLS-scoped SSR client → **(4)** the `/dashboard` React island that drives log → parse → update → delete. `user_id` is set server-side from `context.locals.user`; RLS enforces isolation.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundations | `zod`, `meals` migration + RLS + isolation test, `src/types.ts` | Migration/RLS mistakes leak health data — mitigated by copying the proven canary pattern + SQL proof |
| 2. Parsing service (spike) | OpenRouter client: Polish prompt, structured output, Zod, retry-once | **The headline risk** — first LLM call from a Worker (fetch/`nodejs_compat`, schema support) |
| 3. API routes | `POST /api/meals`, `DELETE /api/meals/[id]`, daily-total helper | First Zod-validated JSON endpoint; correct 400/401/422 handling |
| 4. Dashboard UI | Server-rendered total + `MealLogger` island | Client/server date reconciliation; pending + inline-error UX |

**Prerequisites:** F-01 done (RLS + migration workflow); local Supabase running; a real `OPENROUTER_API_KEY` in `.dev.vars` for Phase 2+.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- OpenRouter reachable from the workerd dev runtime with the chosen model supporting `response_format` json_schema — proven in Phase 2 (confirm the exact model slug then).
- The mid-tier model estimates Polish-food macros well enough to be useful (subjective; per-entry errors are an accepted PRD tradeoff).
- Browser-supplied `day` is acceptable for cross-timezone edge cases in an MVP.

## Success Criteria (Summary)

- A user logs a Polish meal and sees today's macro total update in place within seconds.
- A mis-parsed meal can be deleted; unparseable input errors inline and persists nothing.
- The `meals` RLS proof passes: no user can see another's meals.
