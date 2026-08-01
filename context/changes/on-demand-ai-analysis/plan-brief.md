# On-Demand AI Analysis (S-09) — Plan Brief

> Full plan: `context/changes/on-demand-ai-analysis/plan.md`

## What & Why

The final MVP slice (FR-012): let the user request an on-demand AI analysis of their last N days of logged data that names plausible causes of deviations from ketosis. The differentiating payoff of the product — but only trustworthy if it hedges honestly on thin data, which the PRD calls out as the primary risk.

## Starting Point

The AI-on-Workers boundary is already proven twice (`macros.ts`, `activity-estimate.ts`) and four of the five range reads exist (meals, activities, biomarkers, profile). RLS already isolates every read to the requesting user. Missing: a wellness range read, and everything analysis-specific (aggregation, prompt/schema, route, page).

## Desired End State

At `/analysis`, the user picks a 7/14/30-day window (default 14), clicks "Analizuj", and gets a structured result — summary, plausible causes with the evidence each rests on, a confidence level, and an explicit data-limitations note that reflects how sparse the window actually was. Empty accounts see "log more days" guidance instead of a fabricated analysis. Nothing is stored.

## Key Decisions Made

| Decision                | Choice                                            | Why (1 sentence)                                                                 | Source |
| ----------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| Persistence             | Ephemeral (no table)                              | Smallest slice; matches "on-demand" + MVP Non-Goals; no migration needed.        | Plan   |
| Output shape            | Structured JSON (Zod-validated)                   | Makes confidence + limitations first-class enforceable fields; reuses the boundary. | Plan   |
| Sparse-data hedging     | Server-computed coverage + required output fields | Model gets ground-truth sparsity facts and cannot omit the hedge — testable.      | Plan   |
| Delivery                | Blocking request/response + spinner               | Reuses proven boundary; avoids un-retired streaming risk on Workers.             | Plan   |
| N window                | Preset 7/14/30, default 14                        | Matches FR-012 default; bounds the payload; no free-form validation edge cases.  | Plan   |
| Failure / empty window  | 422 on LLM fail; hedge on sparse; gate on empty   | Spends an LLM call only when there's data; prevents hallucination from nothing.  | Plan   |
| Entry point             | New `/analysis` page + island                     | Consistent with `/history`, `/trends` page pattern.                              | Plan   |

## Scope

**In scope:** wellness range read; window aggregation with per-type coverage; analysis prompt/response schema; OpenRouter analysis client; `POST /api/analysis`; `/analysis` page + island; nav link + route protection.

**Out of scope:** persistence / analysis history, AI chat / follow-ups, export, chart drill-down, streaming, free-form N.

## Architecture / Approach

`AnalysisView` island → `POST /api/analysis {window_days}` → route validates N, calls `gatherAnalysisWindow` (parallel range reads + coverage counts), gates the empty case, then `requestAnalysis` (OpenRouter structured output, Zod-validated) → returns `{status:"ok"|"empty", result, coverage}`. Hedging is enforced twice: coverage facts injected into the prompt + `confidence`/`data_limitations` required in the schema.

## Phases at a Glance

| Phase                              | What it delivers                                              | Key risk                                              |
| ---------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| 1. Data layer & contracts          | Wellness range read, aggregation+coverage, schemas, types    | Coverage counting must be correct — it drives hedging |
| 2. AI service & API route          | OpenRouter analysis client + `POST /api/analysis`            | Prompt/schema quality; empty-gate correctness         |
| 3. Page, island & nav              | `/analysis` page, island, nav link, route protection         | Result rendering must surface the hedge prominently   |

**Prerequisites:** all logging slices (S-01..S-05) + profile (S-02) — all done. `OPENROUTER_API_KEY` set locally.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Analysis quality is subjectively judged (per PRD Secondary Success Criterion) — prompt may need iteration after real-data testing.
- Blocking ~10–30s wait is accepted UX; no streaming fallback.
- Assumes seeded/real multi-week data exists to meaningfully verify the non-sparse path.

## Success Criteria (Summary)

- User requests a 14-day analysis and sees plausible, data-grounded causes with a visible confidence level and honest limitations note.
- A sparse/empty window produces an explicit hedge (or guidance), never confident fabrication.
- The analysis reflects only the requesting user's own data (RLS-enforced).
