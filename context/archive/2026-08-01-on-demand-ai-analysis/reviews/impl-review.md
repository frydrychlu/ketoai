<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: On-Demand AI Analysis (S-09)

- **Plan**: context/changes/on-demand-ai-analysis/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-08-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Clean, pattern-faithful implementation of FR-012. All 9 source files in the diff
are exactly those the plan named — no unplanned files, no missing changes.

- **Plan adherence**: aggregation reuses the four existing range reads plus the
  new `wellness.listEntries`; the OpenRouter client is a faithful copy of the
  `macros.ts` boundary; the route implements validate → aggregate → empty-gate →
  call → 422 as specified.
- **Scope discipline**: "not doing" list respected — no persistence/table, no
  history, no streaming, no export, no chart drill-down, fixed 7/14/30 presets.
- **Safety**: data isolation holds structurally (all reads RLS-scoped, own-data
  aggregation → FR-012 guardrail satisfied); auth checked before work (401) and
  `/analysis` added to `PROTECTED_ROUTES`; inputs Zod-validated; `OPENROUTER_API_KEY`
  stays server-side (`astro:env/server`), never reachable from the island; the LLM
  fetch is wrapped with retry + typed error + 422 mapping. Sending the user's own
  data to OpenRouter is exactly what FR-012 intends (same boundary as S-01/S-04).
- **Patterns**: schema module mirrors `macro-schema.ts`; range read mirrors
  `biomarkers.listReadings`; page/island mirror `history.astro`/`DayHistory.tsx`;
  `cn()` used for class composition; Polish user-facing copy consistent.
- **Success criteria**: re-run fresh at HEAD — `astro check` 0 errors, `npm run lint`
  exit 0, `npm run build` exit 0. All manual checks confirmed by the user.

## Findings

### F1 — No rate limiting on the analysis endpoint

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/analysis/index.ts:37
- **Detail**: `POST /api/analysis` calls the LLM on every request with no throttle.
  An analysis call is heavier than a meal parse (larger prompt, longer output, up to
  30 days of data), so repeated clicks translate directly to OpenRouter spend. This is
  consistent with the existing LLM endpoints (meals/activities POST are also
  unthrottled), so it is not a regression — noted because the per-call cost here is
  higher and this is the last LLM surface added in the MVP.
- **Fix**: None required for the MVP (single-user, matches existing pattern). If cost
  becomes a concern later, add a per-user cooldown shared across the three LLM
  endpoints rather than one-off here.
- **Decision**: SKIPPED (save report only — observation, no action taken)
