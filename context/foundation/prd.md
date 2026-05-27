---
project: KetoAI
version: 1
status: draft
created: 2026-05-26
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 6
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Rigorous ketogenic diet tracking requires simultaneous daily monitoring of macronutrients, caloric expenditure from physical activity, and biomarkers — specifically the GKI index (glucose-to-ketone ratio). Doing this manually across separate tools or with general-purpose AI is tedious and produces no aggregate view. Data lives in silos; the practitioner cannot see the full picture and cannot interpret what the combined numbers mean.

The intersection of GKI tracking, macronutrient aggregation, and AI-driven trend correlation is too narrow a niche for major fitness applications (Cronometer, MyFitnessPal) to prioritize — but it is genuinely valuable for dedicated keto practitioners who actually measure their GKI. A tool that aggregates all of this data in one place and applies AI to surface correlations and explain deviations does not exist for this persona.

## User & Persona

**Primary persona**: Self-tracking keto practitioner

A dedicated individual actively practicing a ketogenic diet who regularly measures their own biomarkers — blood or breath ketones and blood glucose. This person has a daily logging habit: they track meals, physical activity, and biomarker readings. They are fluent in keto concepts (macros, net carbs, GKI index) and reach for this product not to learn keto, but to understand what is happening in their own body over time. The data is personal health data; they expect strict privacy and no sharing.

## Success Criteria

### Primary
- The product works when a user logs meals, activity, and biomarkers daily for at least 2 weeks, then opens the dashboard and sees their biomarker trends correlated with diet and activity data.

### Secondary
- The user requests at least one on-demand AI analysis that correctly identifies a plausible cause for a deviation from ketosis (e.g., elevated GKI linked to a high-carb day). Evaluation is subjective: an experienced keto practitioner assesses the analysis and judges whether the identified cause is plausible given their own knowledge.

### Guardrails
- Personal health data (biomarkers, meal logs, wellness parameters) must not be exposed to third parties or other users.
- The AI analysis must reference only the requesting user's own stored data — no cross-user context under any condition.

## User Stories

### US-01: Daily tracking loop


- **Given** I am a logged-in keto practitioner who has completed my health profile,
- **When** I log today's meals, physical activity, and biomarkers,
- **Then** I see an updated daily macro summary and my biomarker trend charts reflect today's entries.

#### Acceptance Criteria
- Daily macro totals (fat, protein, carbohydrates, calories) update immediately after each meal is logged.
- Biomarker trend charts include the newly logged GKI, ketone, and glucose values.
- Logging any single entry type (meal, activity, or biomarker) does not require the others to be present for the day.

### US-02: Viewing a past day's log

- **Given** I am on the dashboard,
- **When** I select a past calendar date,
- **Then** I see that day's logged meals, activity, biomarkers, wellness parameters, and daily macro summary in read-only mode.

#### Acceptance Criteria
- Selecting a past date displays all entry types logged for that day (or an empty state per entry type if nothing was logged).
- No entry can be created, edited, or deleted from the past-day view.
- Navigating back returns the user to the current-day dashboard view.

## Functional Requirements

### Authentication & Profile
- FR-001: User can register with email and password. Priority: must-have
  > Socrates: Counter-argument considered: "solo app doesn't need server auth." Resolution: kept; cross-device access and server-side AI analysis require server auth.

- FR-002: User can log in and log out. Priority: must-have
  > Socrates: Same counter-argument as FR-001. Resolution: kept.

- FR-003: User can create and edit a health profile (age, weight, height, activity level, health goals). Priority: must-have
  > Socrates: Counter-argument considered: "health profile not required for trend tracking MVP." Resolution: kept; AI analysis requires baseline context (weight, activity level) to produce non-generic insights.

### Daily Logging
- FR-004: User can log a meal by describing it in text; the application breaks the description into macros (calories, fat, protein, carbohydrates) automatically. Priority: must-have
  > Socrates: Counter-argument considered: "automatic macro parsing is error-prone and poisons downstream metrics." Resolution: kept; automatic parsing is the core differentiator. Errors are visible per meal entry.

- FR-005: User can log physical activity with a name or description; the application estimates caloric expenditure as an approximate value. Priority: must-have
  > Socrates: Counter-argument considered: "estimates are ±30–50% inaccurate and may mislead AI analysis." Resolution: kept; estimates are labeled as approximate. Trend visibility (did I move today?) matters more than exact calorie count.

- FR-006: User can log blood ketones (mmol/L) and blood glucose (mg/dL); the application calculates GKI automatically using the formula GKI = (glucose_mg_dL ÷ 18) ÷ ketones_mmol_L. Priority: must-have
  > Socrates: Counter-argument considered: "unit confusion (mg/dL vs mmol/L)." Resolution: units are fixed — glucose is always entered in mg/dL, ketones in mmol/L. GKI is always computed, never entered directly by the user.

- FR-007: User can log additional daily wellness parameters: mood, energy level, sleep quality, water intake, and freeform notes. Priority: must-have
  > Socrates: Counter-argument considered: "these turn KetoAI into a general wellness tracker and add logging friction." Resolution: kept; these parameters feed the AI correlation analysis. The freeform notes field provides context the AI can reference.

### Summaries & Dashboard
- FR-008: User sees a daily summary of total macros and calories aggregated from all meals logged on that calendar day. Priority: must-have
  > Socrates: Counter-argument considered: "no per-meal breakdown means errors from automatic parsing are invisible." Resolution: daily total only (per user decision). Accepted tradeoff.

- FR-009: User sees a dashboard with biomarker trend charts over time (GKI, ketones, glucose), including an empty state with progress guidance when data is sparse. Priority: must-have
  > Socrates: Counter-argument considered: "empty dashboard on day 1 discourages new users." Resolution: kept with empty-state requirement — the dashboard shows "log X more days to see your first trend" guidance until enough data exists.

- FR-010: User sees correlation visualizations between biomarker trends and diet and activity data, including an empty state with progress guidance when data is sparse. Priority: must-have
  > Socrates: Same counter-argument as FR-009. Resolution: kept with same empty-state requirement.

- FR-011: From the dashboard, user can select any past calendar date and view that day's logged entries (meals, activity, biomarkers, wellness parameters) and daily macro summary in read-only mode. Priority: must-have

### AI Analysis
- FR-012: User can request on-demand analysis of their last N days of logged data; N is a configurable parameter the user sets before submitting the analysis request (default suggested: 14 days). The analysis identifies potential causes of deviations from ketosis and must state its confidence level and data limitations explicitly when the data window is sparse. Priority: must-have
  > Socrates: Counter-argument considered: "the analysis will produce confident-sounding explanations even when data is sparse, leading to bad dietary decisions." Resolution: kept with explicit requirement that the analysis states confidence level and hedges when data is insufficient (e.g., "based on 3 days of data — patterns may not be reliable").

## Non-Functional Requirements

- A user's health data (meal logs, biomarkers, activity entries, wellness parameters) is never accessible to other users or transmitted to third parties. Analysis requests include only the requesting user's own data.
- A logged entry (meal, biomarker, activity, wellness parameter) is persisted at the moment of submission. There is no intermediate draft state that can be silently lost if the user closes their session.

## Business Logic

KetoAI analyzes the user's logged meals, physical activity, and biomarkers over time to surface correlations with their general wellness — including but not limited to ketosis state as measured by GKI.

Supporting rules:

1. **GKI calculation**: GKI = (blood glucose in mg/dL ÷ 18) ÷ blood ketones in mmol/L. GKI is computed deterministically each time a biomarker entry is saved. The user never enters GKI directly.

2. **Macro aggregation**: Each meal log produces a fat (g), protein (g), carbohydrates (g), and calorie (kcal) breakdown. The daily macro summary is the arithmetic sum of all meal entries for that calendar day.

3. **Correlation analysis**: On user request, the analysis examines the user's last N days of logged meals, activity, biomarkers, and wellness parameters to identify patterns and plausible causes of deviations from ketosis. The analysis distinguishes between statistically supported observations and speculative suggestions, and states data limitations explicitly when the window contains fewer than a meaningful number of days.

4. **Data isolation**: Each user's logged data is strictly isolated. No analysis for one user incorporates or references data from any other user.

## Access Control

Single-user system; every authenticated user accesses only their own data.

- **Registration**: email and password. A new account creates an isolated data space for that user.
- **Authentication**: a user authenticates with email and password to access their data. An unauthenticated request to any protected route redirects to the login screen.
- **Role model**: flat — one role for all users. There is no admin role, coach role, or viewer role in the MVP.

## Non-Goals

- **No smartwatch or fitness app integrations**: Activity is logged manually. No Apple Health, Garmin, Fitbit, or other fitness platform integrations. Reason: integration complexity is disproportionate for a solo MVP.
- **No laboratory results**: Biomarkers are limited to blood ketones (mmol/L) and blood glucose (mg/dL). No HbA1c, lipid panels, or other clinical lab results.
- **No AI chat (deferred to v2)**: Conversational AI interface is out of MVP scope. On-demand analysis (FR-011) is the only AI interaction in v1. Reason: grounding a conversational AI in user-specific data retrieval adds significant engineering complexity beyond what v1 requires.
- **No data export**: No CSV or PDF export. Data lives in the application. Portability is a v2 concern.
- **No notifications or reminders**: Logging is fully user-initiated. The application does not send push notifications, emails, or in-app reminders.
- **No medications or supplements**: Health profile is limited to body metrics (age, weight, height) and activity level. No clinical medications or dietary supplements.
- **No drill-down from trend chart data points**: Clicking a specific data point on a trend chart does not jump directly to that day's log. Date selection is via a calendar control on the dashboard, not via chart interaction.

## Open Questions

None — all questions resolved.
