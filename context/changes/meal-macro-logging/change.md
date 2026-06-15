---
change_id: meal-macro-logging
title: Meal macro logging
status: implementing
created: 2026-06-09
updated: 2026-06-15
archived_at: null
---

## Notes

**Planning blocked on F-01.** This slice (S-01, the roadmap north star) depends on
`data-isolation-baseline` (F-01), which establishes the Supabase migration workflow + the
per-operation/per-role RLS policy pattern + a cross-user verification harness. As of 2026-06-09
F-01 has not been implemented — there is no `supabase/migrations/` directory. Decision (2026-06-09):
plan and implement F-01 first via `/10x-plan data-isolation-baseline`, then return to plan S-01 on
top of the proven pattern. No `plan.md` written yet.

### Decisions already made for S-01 (carry into the plan when F-01 lands)

- **AI request mode:** synchronous JSON request to OpenRouter (await full response, return a small
  macros object). Macro parsing yields ~4 numbers — no streaming; avoids the Workers `ReadableStream`
  footgun in `infrastructure.md`. `fetch` await is I/O wait, not CPU, so the 10 ms free-tier CPU cap
  is not the bottleneck.
- **Output format:** enforce a JSON schema via OpenRouter `response_format` (structured output), then
  validate with Zod before persisting. Bad output is caught at the boundary, never reaches the DB.
- **Parse failure handling:** retry the LLM call once on failure/unparseable output, then reject —
  show an inline error on the meal form and persist nothing (honors the NFR: no silent draft state;
  keeps the daily macro total trustworthy).

### Open prerequisites surfaced during planning (likely belong to F-01 or this slice's setup)

- **Zod is not installed**, yet `AGENTS.md` mandates Zod validation on all API routes. Add `zod` as a
  dependency before the first validated endpoint.
- **`src/types.ts` does not exist** — `AGENTS.md` says shared entity/DTO types live there; create it
  for the meal + macros DTOs.
- **OpenRouter is half-wired:** `OPENROUTER_API_KEY` is in the `astro:env` schema (`astro.config.mjs`)
  but there is no client code yet. The first real LLM-from-Worker call is this slice's headline risk.
