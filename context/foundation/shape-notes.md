---
project: KetoAI
context_type: greenfield
updated: 2026-05-26
product_type: web-app
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 6
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  frs_drafted: 11
  quality_check_status: accepted
---

## Vision & Problem Statement

**One-sentence rule**: KetoAI is a personal keto tracking companion that aggregates daily meals, physical activity, and biomarkers (ketones, glucose, GKI) in one place, then uses AI to surface the correlations and explain deviations from ketosis.

**Pain**: Rigorous keto tracking requires simultaneous monitoring of macronutrients, caloric expenditure from activity, and biomarkers — specifically the GKI index. Doing this manually across separate tools or with general-purpose AI is tedious and produces no trend analysis. Data lives in silos; the practitioner can't see the full picture, and can't interpret what the numbers mean together.

**Pain categories**: Data trapped in silos + Decision paralysis (user has numbers but can't interpret what they mean for ketosis state)

**Moment**: Every day — after meals, after exercise, after blood/breath measurement — when the user needs to log data and understand what the combined numbers mean.

**Cost today**: Manual logging across multiple tools + general AI = no aggregate view, no trend detection, no correlation insights between diet, activity, and ketosis state.

**Insight**: The intersection of GKI + macros + AI-driven trend correlation is too niche for major fitness apps (Cronometer, MyFitnessPal) to prioritize, but genuinely valuable for dedicated keto practitioners who actually measure their GKI.

## User & Persona

**Primary persona**: Self-tracking keto practitioner

- Role: An individual actively practicing a ketogenic diet who regularly measures their own biomarkers (blood/breath ketones, blood glucose)
- Context: Private data, single-user focus — this is personal health data. No sharing, no team features.
- Behavior: Daily logging habit — meals, activity, biomarkers. Seeks to understand correlations and diagnose deviations from ketosis.
- Knowledge level: Understands keto concepts (macros, net carbs, GKI index) — not a beginner who needs education-first UX.

## Access Control

- **Auth model**: Email + password login. Data lives on a server; accessible from any device.
- **Role model**: Flat — one user, one role. The practitioner is the only actor. No admin, no coach, no shared access.
- **Minimum viable access**: Registration + login. Session-based auth is sufficient for MVP.

## Success Criteria

### Primary
The product works when a user logs meals, activity, and biomarkers daily for at least 2 weeks, then opens the dashboard and sees their biomarker trends correlated with diet and activity data.

### Secondary
The user requests at least one on-demand AI analysis that correctly identifies a plausible cause for a deviation from ketosis (e.g., elevated GKI linked to a high-carb day).

### Guardrails
- Personal health data (biomarkers, meal logs) must not be exposed to third parties or other users.
- The AI chat and analysis must only reference the logged-in user's own data — no cross-user context.

## Functional Requirements

### Authentication & Profile
- FR-001: User can register with email + password. Priority: must-have
  > Socrates: Counter-argument considered: "solo app doesn't need server auth." Resolution: kept; cross-device access and server-side AI analysis require server auth.

- FR-002: User can log in and log out. Priority: must-have
  > Socrates: Same counter-argument as FR-001. Resolution: kept.

- FR-003: User can create and edit a health profile (age, weight, height, activity level, health goals). Priority: must-have
  > Socrates: Counter-argument considered: "health profile not required for trend tracking MVP." Resolution: kept; AI analysis requires baseline context (weight, activity level) to produce non-generic insights.

### Daily Logging
- FR-004: User can log a meal by describing it in text; app breaks it into macros (calories, fat, protein, carbs) automatically using AI. Priority: must-have
  > Socrates: Counter-argument considered: "AI macro parsing is error-prone and poisons downstream metrics." Resolution: kept; AI parsing is the core differentiator. Errors are visible via per-meal logging, and the hybrid confirm-before-save pattern can be added if needed.

- FR-005: User can log physical activity with a name/description; app estimates caloric expenditure as an approximate value. Priority: must-have
  > Socrates: Counter-argument considered: "estimates are ±30-50% inaccurate and may mislead AI analysis." Resolution: kept; estimates are labeled as approximate. Trend (did I move today?) matters more than exact calorie count.

- FR-006: User can log biomarkers: blood ketones (mmol/L) and blood glucose (mg/dL); app calculates GKI automatically using the formula GKI = (glucose_mg_dL / 18) / ketones_mmol_L. Priority: must-have
  > Socrates: Counter-argument considered: "unit confusion (mg/dL vs mmol/L)." Resolution: resolved by fixing the units: glucose is always entered in mg/dL, ketones in mmol/L. GKI formula is GKI = (glucose / 18) / ketones. No unit selection needed.

- FR-007: User can log additional daily parameters: mood, energy, sleep quality, water intake, and other freeform notes. Priority: must-have
  > Socrates: Counter-argument considered: "these turn KetoAI into a general wellness tracker and add logging friction." Resolution: kept; these parameters feed the AI correlation analysis. The freeform field is particularly important for AI context. User is willing to log them.

### Summaries & Dashboard
- FR-008: User sees a daily summary of total macros and calories from all meals of that day. Priority: must-have
  > Socrates: Counter-argument considered: "no per-meal breakdown means errors from AI parsing are invisible." Resolution: daily total only (per user decision). Accepted tradeoff.

- FR-009: User sees a dashboard with biomarker trend charts over time (GKI, ketones, glucose), including an empty state with progress guidance when data is sparse. Priority: must-have
  > Socrates: Counter-argument considered: "empty dashboard on day 1 discourages new users." Resolution: kept with empty-state requirement: show 'log X more days to see your first trend' guidance.

- FR-010: User sees correlation visualizations between biomarker trends and diet/activity data, including an empty state with progress guidance. Priority: must-have
  > Socrates: Same counter-argument as FR-009. Resolution: kept with same empty-state requirement.

### AI Features
- FR-011: User can request on-demand AI analysis of the last N days of keto/glucose/GKI data; AI identifies potential causes of deviations from ketosis; AI must state confidence level and data limitations when data is sparse. Priority: must-have
  > Socrates: Counter-argument considered: "AI will hallucinate confident explanations even when data is sparse, leading to bad dietary decisions." Resolution: kept with explicit requirement that AI states confidence and hedges when data is insufficient (e.g., 'based on 3 days of data — patterns may not be reliable').

### Out of MVP scope (Socrates moved)
- FR-012 (removed): AI chat over personal data — moved out of MVP. Counter-argument accepted: grounding AI chat in user-specific retrieval is significant engineering complexity. Will be added in v2.

## Business Logic

**Domain rule**: KetoAI analyzes the user's logged meals, activity, and biomarkers over time to understand what correlates with their general wellness — including but not limited to ketosis state as measured by GKI.

**Supporting rules**:
1. **GKI calculation**: GKI = (glucose_mg_dL / 18) / ketones_mmol_L. This is a deterministic formula applied every time a biomarker entry is saved. GKI is computed, not entered by the user.
2. **Macro aggregation**: Each meal entry produces fat (g), protein (g), carbohydrates (g), and calories (kcal) via AI parsing. The daily summary is the sum of all meals logged on that calendar day.
3. **AI analysis**: On user request, the app sends the last N days of logged data (meals, activity, biomarkers, wellness parameters) to an LLM with instructions to identify patterns and correlations. The AI must distinguish between statistically supported observations and speculative suggestions, and must state data limitations when fewer than a meaningful number of days have been logged.
4. **Data isolation**: Each user's data is strictly isolated. No cross-user queries, no shared AI context.

## Non-Functional Requirements

- **Privacy**: A user's health data (meal logs, biomarkers, activity, wellness parameters) is never accessible to other users or shared with third parties. AI API calls include only the requesting user's own data.
- **Data durability**: A logged entry (meal, biomarker, activity, wellness parameter) is persisted immediately on submission. There is no draft state that can be silently lost if the user closes the browser.

## User Stories

### US-01: Daily tracking loop
**Given** I'm a logged-in keto practitioner who has completed my health profile,
**When** I log today's meals, activity, and biomarkers,
**Then** I see an updated daily macro summary and my biomarker trend charts reflect today's entries.

## Non-Goals

- **No smartwatch / fitness app integrations**: Activity is logged manually. No Apple Health, Garmin, Fitbit, or other fitness platform integrations. Reason: integration complexity is out of proportion for a solo MVP.
- **No lab results**: Biomarkers are limited to blood ketones (mmol/L) and blood glucose (mg/dL). No HbA1c, lipid panels, or other clinical lab data.
- **No AI chat (v2)**: Conversational AI interface removed from MVP scope (see Socrates round, FR-012). On-demand AI analysis (FR-011) is the only AI interaction in v1.
- **No export**: No CSV or PDF export. Data lives in the app. Portability is a v2 concern.
- **No notifications or reminders**: Logging is fully user-initiated. The app doesn't send push notifications, emails, or in-app reminders.
- **No medications or supplements**: Health profile is limited to body metrics (age, weight, height) and activity level. No clinical medications or dietary supplements.
- **No drill-down from trend charts**: Clicking a data point on the trend chart does not open a detail view in MVP.

## Quality cross-check
All 5 greenfield elements verified on 2026-05-26. Status: accepted.
- Access Control: present — email+password, flat single-user
- Business Logic: present — one-sentence correlation rule + 4 supporting rules (GKI formula, macro aggregation, AI analysis, data isolation)
- Project artifacts: present
- Timeline-cost acknowledged: present — 6-week after-hours MVP, acknowledged 2026-05-26
- Non-Goals: present — 7 entries

## Timeline acknowledgment
Acknowledged on 2026-05-26: 6-week MVP requires sustained dedication (after-hours work, evenings/weekends). Full scope includes AI macro parsing, trend dashboard, on-demand AI analysis, and AI chat. User accepted the sustained-effort cost explicitly.

