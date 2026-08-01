---
project: KetoAI
version: 1
status: draft
created: 2026-06-02
updated: 2026-08-01
prd_version: 1
main_goal: speed
top_blocker: skills
---

# Roadmap: KetoAI

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

KetoAI aggregates a keto practitioner's daily meals, physical activity, and biomarkers — blood ketones, blood glucose, and the derived GKI index (glucose-to-ketone ratio) — in one place, then uses AI to surface correlations and explain deviations from ketosis. The differentiating bet is the intersection of GKI tracking, automatic macro aggregation from free-text meal descriptions, and AI-driven trend correlation: a niche too narrow for Cronometer or MyFitnessPal to serve, but genuinely valuable for practitioners who actually measure their own GKI. All data is private personal health data, strictly isolated per user.

## North star

**S-01: User can log a meal in plain text and immediately see today's auto-parsed macro total (fat, protein, carbs, calories).**

> "North star" here means the smallest end-to-end slice whose successful delivery would prove the product's core hypothesis — placed as early as its prerequisites allow, because everything downstream only matters if this works. S-01 is the north star because it exercises the core differentiator (AI macro parsing) end-to-end and forces the single riskiest technical unknown — calling an LLM from inside a Cloudflare Worker — to surface in the first user-facing slice rather than late in the build. On a `speed` bias, proving the hardest must-have path first is the safest order.

## At a glance

| ID    | Change ID                  | Outcome (user can …)                                              | Prerequisites          | PRD refs              | Status   |
| ----- | -------------------------- | ----------------------------------------------------------------- | ---------------------- | --------------------- | -------- |
| F-01  | data-isolation-baseline    | (foundation) per-user RLS isolation + migration workflow proven   | —                      | NFR (privacy), AC     | ready    |
| S-01  | meal-macro-logging         | log a meal in text and see today's auto-parsed macro total        | F-01                   | FR-004, FR-008, US-01 | done     |
| S-02  | health-profile             | create and edit their health profile (account already in place)   | F-01                   | FR-001, FR-002, FR-003, US-01 | done     |
| S-03  | biomarker-gki-logging      | log ketones + glucose and see GKI computed automatically          | F-01                   | FR-006, US-01         | done     |
| S-04  | activity-logging           | log physical activity with an estimated caloric expenditure       | F-01                   | FR-005                | done     |
| S-05  | wellness-logging           | log mood, energy, sleep, water, and freeform notes for the day    | F-01                   | FR-007                | done     |
| S-06  | biomarker-trend-dashboard  | see GKI / ketone / glucose trend charts over time                 | S-03                   | FR-009, US-01         | done     |
| S-07  | diet-activity-correlation  | see biomarker trends visualized against diet and activity data    | S-06, S-01, S-04       | FR-010                | done     |
| S-08  | past-day-readonly-view     | select a past date and view that day's log read-only              | S-01, S-03, S-04, S-05 | FR-011, US-02         | done     |
| S-09  | on-demand-ai-analysis      | request AI analysis of the last N days of data on demand          | S-01, S-02, S-03, S-04, S-05 | FR-012          | done     |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                       | Chain                                  | Note                                                                              |
| ------ | --------------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| A      | Foundation & macro loop     | `F-01` → `S-01`                         | The must-have path on a `speed` bias; `F-01` unlocks every logging slice, `S-01` is the north star. |
| B      | Biomarkers & trends         | `S-03` → `S-06` → `S-07`               | `S-07` joins Stream A at `S-01` (diet) and Stream C at `S-04` (activity) for correlation inputs.     |
| C      | Profile & secondary logging | `S-02` / `S-04` / `S-05`               | Three independent slices, each off `F-01`; fully parallel with Stream A and each other.             |
| D      | Read-back & AI analysis     | `S-08` → `S-09`                        | Both consume the logging streams; sequenced last because they need accumulated data across types.   |

(Every `F-NN` and `S-NN` appears in exactly one stream.)

## Baseline

What's already in place in the codebase as of 2026-06-02 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19; `src/layouts/Layout.astro`, shadcn/ui (`src/components/ui/button.tsx`), `src/pages/dashboard.astro`.
- **Backend / API:** partial — only auth routes exist (`src/pages/api/auth/{signin,signout,signup}.ts`); no domain endpoints yet.
- **Data:** absent — Supabase is declared (`src/lib/supabase.ts`) but there are no migrations and no application tables; only Supabase Auth's `auth.users` is in use.
- **Auth:** present — `src/middleware.ts` guards `/dashboard` and attaches `context.locals.user`; SSR client in `src/lib/supabase.ts`; sign-in / sign-up / sign-out flows implemented.
- **Deploy / infra:** present — Cloudflare Workers wired (`@astrojs/cloudflare`, `wrangler.jsonc`), CI in place, production deploy already done (per git history).
- **Observability:** partial — Workers observability enabled in `wrangler.jsonc`; no application-level logging or error tracking.

## Foundations

### F-01: Per-user data persistence & isolation baseline

- **Outcome:** (foundation) the Supabase migration workflow is established and a granular, per-operation, per-role RLS policy pattern is proven to isolate one authenticated user's rows from another's — with a repeatable verification path that every later logging table follows.
- **Change ID:** data-isolation-baseline
- **PRD refs:** Non-Functional Requirements (privacy / data isolation), Business Logic rule 4 (data isolation), Access Control
- **Unlocks:** S-01, S-02, S-03, S-04, S-05 (every slice that introduces a per-user table relies on this RLS + migration convention); reduces the blocking unknown "how is strict per-user isolation enforced and verified".
- **Prerequisites:** — (builds on the present auth baseline)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** RLS is new on this stack (the `skills` blocker). This Foundation deliberately establishes the isolation contract + a cross-user verification harness ONCE, rather than letting every slice re-derive RLS — a mis-set policy silently leaks personal health data, which the PRD names as a hard guardrail. Scope is capped: it builds no domain tables; each slice adds its own table following the proven pattern.
- **Status:** ready

## Slices

### S-01: Meal logging with auto-parsed daily macros

- **Outcome:** user can log a meal by describing it in text and immediately see today's macro total (fat, protein, carbs, calories) update.
- **Change ID:** meal-macro-logging
- **PRD refs:** FR-004, FR-008, US-01
- **Prerequisites:** F-01
- **Parallel with:** S-02, S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - Does the AI macro-parsing request run within the Workers free-tier 10 ms CPU cap and the platform's `fetch`/streaming model? — Owner: user. Block: no (planning can proceed; this is a Week-1 spike inside the slice, per infra pre-mortem).
- **Risk:** This is the north star and carries the riskiest technical unknown — the first LLM call from a Cloudflare Worker (CPU cap, `nodejs_compat`, streaming all flagged in `infrastructure.md`). Sequenced first on the `speed` bias so the hardest must-have path is proven before anything depends on it. Parsing errors are visible per meal entry (accepted PRD tradeoff).
- **Status:** done

### S-02: Health profile

- **Outcome:** user can create and edit their health profile (age, weight, height, activity level, health goals).
- **Change ID:** health-profile
- **PRD refs:** FR-001, FR-002, FR-003, US-01
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low. Registration and login (FR-001, FR-002) are already implemented per the present auth baseline — this slice adds the profile entity + edit UI and confirms the post-registration → profile flow that US-01 assumes ("a logged-in practitioner who has completed my health profile"). The profile also supplies the baseline context S-09's AI analysis needs.
- **Status:** done

### S-03: Biomarker logging with automatic GKI

- **Outcome:** user can log blood ketones (mmol/L) and blood glucose (mg/dL) and see GKI computed automatically.
- **Change ID:** biomarker-gki-logging
- **PRD refs:** FR-006, US-01
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-02, S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low. GKI = (glucose ÷ 18) ÷ ketones is deterministic and computed server-side on save; units are fixed so there's no unit-selection ambiguity. This slice produces the time-series that S-06 charts.
- **Status:** done

### S-04: Physical activity logging

- **Outcome:** user can log physical activity with a name/description and see an approximate caloric expenditure estimate.
- **Change ID:** activity-logging
- **PRD refs:** FR-005
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-02, S-03, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low. Estimates are explicitly labeled approximate (PRD-accepted tradeoff); trend visibility ("did I move today?") matters more than exact calories. Reuses the AI request boundary established and de-risked in S-01.
- **Status:** done

### S-05: Daily wellness parameters logging

- **Outcome:** user can log mood, energy level, sleep quality, water intake, and freeform notes for the day.
- **Change ID:** wellness-logging
- **PRD refs:** FR-007
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-02, S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low. Straightforward per-day entry following the F-01 table pattern. The freeform notes field is the context the S-09 AI analysis can reference, so capturing it early increases later analysis quality.
- **Status:** done

### S-06: Biomarker trend dashboard

- **Outcome:** user can see GKI, ketone, and glucose trend charts over time, with an empty state that guides them when data is sparse.
- **Change ID:** biomarker-trend-dashboard
- **PRD refs:** FR-009, US-01
- **Prerequisites:** S-03
- **Parallel with:** S-02, S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - Does the chosen chart approach keep the Worker bundle under the 10 MB free-tier limit? — Owner: user. Block: no (a `/10x-plan` / build-time concern, flagged by `infrastructure.md`, not a roadmap blocker).
- **Risk:** First slice to introduce a charting dependency — `infrastructure.md` flags Worker bundle size (10 MB compressed on free tier) as a watch item. Needs S-03's biomarker data to render anything beyond the empty state.
- **Status:** done

### S-07: Diet & activity correlation visualizations

- **Outcome:** user can see biomarker trends visualized against their diet (macros) and activity data, with an empty state when data is sparse.
- **Change ID:** diet-activity-correlation
- **PRD refs:** FR-010
- **Prerequisites:** S-06, S-01, S-04
- **Blockers:** —
- **Parallel with:** S-08
- **Unknowns:** —
- **Risk:** Convergence slice — depends on three independent data streams (biomarkers via S-06, diet via S-01, activity via S-04). Sequenced after them so it has real series to correlate. This is the visual payoff of the Primary Success Criterion (trends correlated with diet and activity).
- **Status:** done

### S-08: Past-day read-only view

- **Outcome:** user can select a past calendar date and view that day's meals, activity, biomarkers, wellness parameters, and macro summary in read-only mode.
- **Change ID:** past-day-readonly-view
- **PRD refs:** FR-011, US-02
- **Prerequisites:** S-01, S-03, S-04, S-05
- **Blockers:** —
- **Parallel with:** S-07
- **Unknowns:** —
- **Risk:** Read-only enforcement is the load-bearing constraint (US-02: no create/edit/delete from the past-day view). Depends on the logging slices existing so there's a day to read back. Date selection is via a calendar control, not chart drill-down (explicit Non-Goal).
- **Status:** done

### S-09: On-demand AI analysis

- **Outcome:** user can request an AI analysis of their last N days of logged data (N configurable, default 14) that identifies plausible causes of deviations from ketosis and states its confidence and data limitations.
- **Change ID:** on-demand-ai-analysis
- **PRD refs:** FR-012
- **Prerequisites:** S-01, S-02, S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - How is the "state confidence level and data limitations when the window is sparse" requirement enforced in the prompt/response contract? — Owner: user. Block: no (a `/10x-plan` design detail, not a sequencing blocker).
- **Risk:** Sequenced last among features — it needs accumulated data across all logging types plus profile context (S-02) to produce non-generic insight. Reuses the AI-on-Workers boundary proven in S-01, so the platform risk is already retired by the time this lands. Must hedge explicitly on sparse data (PRD guardrail).
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID                  | Suggested issue title                                   | Ready for `/10x-plan` | Notes                                  |
| ---------- | -------------------------- | ------------------------------------------------------- | --------------------- | -------------------------------------- |
| F-01       | data-isolation-baseline    | Per-user RLS isolation + Supabase migration baseline    | yes                   | Run `/10x-plan data-isolation-baseline` |
| S-01       | meal-macro-logging         | Meal logging with auto-parsed daily macros (north star) | no                    | After F-01; spike AI-on-Workers here   |
| S-02       | health-profile             | Health profile create/edit                              | no                    | After F-01                             |
| S-03       | biomarker-gki-logging       | Biomarker logging with automatic GKI                    | no                    | After F-01                             |
| S-04       | activity-logging           | Physical activity logging with estimated calories       | no                    | After F-01                             |
| S-05       | wellness-logging           | Daily wellness parameters logging                       | no                    | After F-01                             |
| S-06       | biomarker-trend-dashboard  | Biomarker trend dashboard                               | no                    | After S-03; watch Worker bundle size   |
| S-07       | diet-activity-correlation  | Diet & activity correlation visualizations              | no                    | After S-06, S-01, S-04                 |
| S-08       | past-day-readonly-view     | Past-day read-only view                                 | no                    | After S-01, S-03, S-04, S-05           |
| S-09       | on-demand-ai-analysis      | On-demand AI analysis of last N days                    | no                    | After all logging slices + S-02        |

This table is the clean handoff to Jira/Linear or any MCP-backed backlog.

## Open Roadmap Questions

None. The PRD resolved all its Open Questions ("None — all questions resolved"), and the interview surfaced no cross-cutting sequencing question. Per-slice technical unknowns (AI-on-Workers spike in S-01, chart bundle size in S-06, sparse-data hedging contract in S-09) live on their slices and do not block planning.

## Parked

- **Smartwatch / fitness-app integrations** — Why parked: PRD §Non-Goals — activity is logged manually; integration complexity is disproportionate for a solo MVP.
- **Laboratory results (HbA1c, lipid panels, etc.)** — Why parked: PRD §Non-Goals — biomarkers are limited to blood ketones and blood glucose.
- **AI chat over personal data** — Why parked: PRD §Non-Goals — deferred to v2; grounding conversational AI in user-specific retrieval is significant engineering complexity. On-demand analysis (FR-012) is the only AI interaction in v1.
- **Data export (CSV / PDF)** — Why parked: PRD §Non-Goals — data lives in the app; portability is a v2 concern.
- **Notifications and reminders** — Why parked: PRD §Non-Goals — logging is fully user-initiated.
- **Medications and supplements** — Why parked: PRD §Non-Goals — health profile is limited to body metrics and activity level.
- **Drill-down from trend-chart data points** — Why parked: PRD §Non-Goals — date selection is via a calendar control (S-08), not chart interaction.

## Done

- **S-09: user can request an AI analysis of their last N days of logged data (N configurable, default 14) that identifies plausible causes of deviations from ketosis and states its confidence and data limitations.** — Archived 2026-08-01 → `context/archive/2026-08-01-on-demand-ai-analysis/`. Lesson: —.
- **S-08: user can select a past calendar date and view that day's meals, activity, biomarkers, wellness parameters, and macro summary in read-only mode.** — Archived 2026-08-01 → `context/archive/2026-08-01-past-day-readonly-view/`. Lesson: —.
- **S-07: user can see biomarker trends visualized against their diet (macros) and activity data, with an empty state when data is sparse.** — Archived 2026-07-02 → `context/archive/2026-07-02-diet-activity-correlation/`. Lesson: —.
- **S-06: user can see GKI, ketone, and glucose trend charts over time, with an empty state that guides them when data is sparse.** — Archived 2026-07-02 → `context/archive/2026-07-01-biomarker-trend-dashboard/`. Lesson: —.
- **S-01: user can log a meal by describing it in text and immediately see today's macro total (fat, protein, carbs, calories) update.** — Archived 2026-07-02 → `context/archive/2026-06-09-meal-macro-logging/`. Lesson: —.
- **S-02: user can create and edit their health profile (age, weight, height, activity level, health goals).** — Archived 2026-07-02 → `context/archive/2026-06-16-health-profile/`. Lesson: —.
- **S-03: user can log blood ketones (mmol/L) and blood glucose (mg/dL) and see GKI computed automatically.** — Archived 2026-07-02 → `context/archive/2026-06-30-biomarker-gki-logging/`. Lesson: —.
- **S-04: user can log physical activity with a name/description and see an approximate caloric expenditure estimate.** — Archived 2026-07-02 → `context/archive/2026-06-30-activity-logging/`. Lesson: —.
- **S-05: user can log mood, energy level, sleep quality, water intake, and freeform notes for the day.** — Archived 2026-07-02 → `context/archive/2026-06-30-wellness-logging/`. Lesson: —.
