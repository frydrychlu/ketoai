// Shared entity and DTO types for KetoAI. New shared types go here (per AGENTS.md),
// not in feature files.

/**
 * The four macro numbers for a meal or a daily aggregate.
 * Field names mirror the `public.meals` columns so values returned by the
 * Supabase client map straight through with no snake/camel translation layer.
 */
export interface MacroBreakdown {
  fat_g: number;
  protein_g: number;
  carbs_g: number;
  calories_kcal: number;
}

/** A persisted meal row (shape returned by the Supabase client for public.meals). */
export interface Meal extends MacroBreakdown {
  id: string;
  user_id: string;
  description: string;
  /** Local calendar date the meal counts toward, ISO `YYYY-MM-DD`. */
  day: string;
  /** Server insert timestamp, ISO 8601. */
  logged_at: string;
}

/** Request body for creating a meal: raw text + the browser's local date. */
export interface CreateMealCommand {
  description: string;
  /** The client's local calendar date, ISO `YYYY-MM-DD`. */
  day: string;
}

/** Aggregated macro totals for a single day. */
export type DailyMacroTotal = MacroBreakdown;

/**
 * One aggregated day in a diet range series: a `day` plus that day's macro
 * total. Returned by the meals range read (`listDailyTotals`) and charted by the
 * trends island. Only days that have meals appear — there are no zero rows.
 */
export type DailyMacroSeriesPoint = { day: string } & DailyMacroTotal;

// --- Health profile (S-02) -------------------------------------------------

/**
 * The five standard activity levels (TDEE ladder). Stored as text on
 * `public.health_profiles` and guarded by a CHECK constraint; the API's Zod
 * enum and the form's options both source their values from `ACTIVITY_LEVELS`.
 */
export const ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "very", "extra"] as const;

/** One of the five activity-level keys. */
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/**
 * A persisted health-profile row (shape returned by the Supabase client for
 * public.health_profiles). A singleton per user. All profile fields are nullable
 * because partial saves are allowed.
 */
export interface HealthProfile {
  id: string;
  user_id: string;
  age: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  activity_level: ActivityLevel | null;
  health_goals: string | null;
  /** Row insert timestamp, ISO 8601. */
  created_at: string;
  /** Row last-update timestamp, ISO 8601. */
  updated_at: string;
}

/**
 * The validated upsert payload for a health profile. Every field is nullable:
 * a cleared field is sent as explicit `null` so the upsert NULLs that column on
 * the conflict-UPDATE path (never `undefined`, which PostgREST would skip).
 */
export interface UpdateHealthProfileCommand {
  age: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  activity_level: ActivityLevel | null;
  health_goals: string | null;
}

// --- Biomarker readings (S-03) ---------------------------------------------

/**
 * A persisted biomarker reading (shape returned by the Supabase client for
 * public.biomarker_readings). A singleton per (user, day): re-logging the same
 * day upserts the row. Field names mirror the DB columns. `gki` is computed
 * server-side as (glucose_mg_dl / 18) / ketones_mmol_l and stored — never
 * user-entered. All numeric fields are non-null (both inputs are required).
 */
export interface BiomarkerReading {
  id: string;
  user_id: string;
  /** Local calendar date the reading counts toward, ISO `YYYY-MM-DD`. */
  day: string;
  /** Blood ketones in mmol/L (fixed unit). Strictly positive. */
  ketones_mmol_l: number;
  /** Blood glucose in mg/dL (fixed unit). */
  glucose_mg_dl: number;
  /** Glycemic-ketone index, computed server-side and stored. */
  gki: number;
  /** Row insert timestamp, ISO 8601. */
  created_at: string;
  /** Row last-update timestamp, ISO 8601. */
  updated_at: string;
}

/**
 * The validated upsert payload for a biomarker reading. Both inputs are
 * required; `gki` is NOT part of the request — the server computes it from
 * these two values before storing.
 */
export interface UpsertBiomarkerReadingCommand {
  /** The client's local calendar date, ISO `YYYY-MM-DD`. */
  day: string;
  ketones_mmol_l: number;
  glucose_mg_dl: number;
}

// --- Physical activity (S-04) ----------------------------------------------

/**
 * A persisted activity row (shape returned by the Supabase client for
 * public.activities). Field names mirror the DB columns so values map straight
 * through with no snake/camel translation layer.
 */
export interface Activity {
  id: string;
  user_id: string;
  description: string;
  /** Estimated caloric expenditure (kcal) from the LLM; non-negative, always present. */
  calories_kcal: number;
  /** Local calendar date the activity counts toward, ISO `YYYY-MM-DD`. */
  day: string;
  /** Server insert timestamp, ISO 8601. */
  logged_at: string;
}

/**
 * Request body for creating an activity: raw text + the browser's local date.
 * No `calories_kcal` — the server estimates it from the description.
 */
export interface CreateActivityCommand {
  description: string;
  /** The client's local calendar date, ISO `YYYY-MM-DD`. */
  day: string;
}

/** Aggregated caloric expenditure for a single day. */
export interface DailyExpenditureTotal {
  calories_kcal: number;
}

/**
 * One aggregated day in an activity range series: a `day` plus that day's total
 * estimated caloric expenditure. Returned by the activities range read
 * (`listDailyExpenditure`) and charted by the trends island. Only days that have
 * activities appear — there are no zero rows.
 */
export interface DailyExpenditureSeriesPoint {
  day: string;
  calories_kcal: number;
}

// --- Daily wellness parameters (S-05) --------------------------------------

/**
 * A persisted wellness entry (shape returned by the Supabase client for
 * public.wellness_entries). A singleton per (user, day): re-logging the same
 * day upserts the row. Every wellness field is nullable — the user may save any
 * subset (partial save), mirroring the health-profile convention. Field names
 * mirror the DB columns.
 */
export interface WellnessEntry {
  id: string;
  user_id: string;
  /** Local calendar date the entry counts toward, ISO `YYYY-MM-DD`. */
  day: string;
  /** Subjective mood self-rating, integer 1–10. */
  mood: number | null;
  /** Subjective energy self-rating, integer 1–10. */
  energy: number | null;
  /** Subjective sleep-quality self-rating, integer 1–10. */
  sleep_quality: number | null;
  /** Water intake in liters. */
  water_liters: number | null;
  /** Freeform notes for the day. */
  notes: string | null;
  /** Row insert timestamp, ISO 8601. */
  created_at: string;
  /** Row last-update timestamp, ISO 8601. */
  updated_at: string;
}

/**
 * The validated upsert payload for a wellness entry. Every wellness field is
 * nullable: a cleared field is sent as explicit `null` so the upsert NULLs that
 * column on the conflict-UPDATE path (never `undefined`, which PostgREST would
 * skip). The route's Zod schema additionally requires at least one field to be
 * non-null — a fully-empty body is rejected.
 */
export interface UpsertWellnessEntryCommand {
  /** The client's local calendar date, ISO `YYYY-MM-DD`. */
  day: string;
  mood: number | null;
  energy: number | null;
  sleep_quality: number | null;
  water_liters: number | null;
  notes: string | null;
}

// --- AI analysis (S-09) ----------------------------------------------------

/**
 * The window sizes (in days) the on-demand analysis offers. Fixed presets — the
 * route's Zod schema and the island's selector both source their values here.
 * 14 is the FR-012 default.
 */
export const ANALYSIS_WINDOWS = [7, 14, 30] as const;

/** One of the allowed analysis window sizes. */
export type AnalysisWindowDays = (typeof ANALYSIS_WINDOWS)[number];

/**
 * How many days within the requested window actually hold data of each type,
 * computed server-side from the gathered rows. Passed into the prompt as
 * ground-truth facts so the model hedges against real sparsity (the FR-012
 * guardrail) rather than guessing. `hasAnyData` gates the LLM call: a window
 * with zero data of every type short-circuits to the empty response.
 */
export interface AnalysisCoverage {
  /** N — the requested window size in days. */
  totalDays: number;
  /** Days in the window that have at least one meal. */
  mealDays: number;
  /** Days in the window that have at least one activity. */
  activityDays: number;
  /** Days in the window that have a biomarker reading. */
  biomarkerDays: number;
  /** Days in the window that have a wellness entry. */
  wellnessDays: number;
  /** Whether the profile exists (baseline context for the analysis). */
  hasProfile: boolean;
  /** True when any data type has at least one day of data. */
  hasAnyData: boolean;
}

/**
 * The assembled N-day window the analysis reasons over: the user's profile plus
 * the per-day series for each data type, plus the computed coverage. Meals and
 * activities are pre-aggregated to daily totals (only days with data appear);
 * biomarkers and wellness are one row per day. Built by `gatherAnalysisWindow`.
 */
export interface AnalysisWindow {
  profile: HealthProfile | null;
  meals: DailyMacroSeriesPoint[];
  activities: DailyExpenditureSeriesPoint[];
  biomarkers: BiomarkerReading[];
  wellness: WellnessEntry[];
  coverage: AnalysisCoverage;
}

/**
 * One plausible cause of a deviation from ketosis, with the data observation
 * that supports it. The model must ground each cause in the provided window.
 */
export interface AnalysisCause {
  cause: string;
  evidence: string;
}

/**
 * The validated structured result of an analysis (mirrors
 * `analysisResultSchema`). `confidence` and `data_limitations` are required —
 * the model cannot omit the FR-012 hedge.
 */
export interface AnalysisResult {
  summary: string;
  causes: AnalysisCause[];
  confidence: "low" | "medium" | "high";
  data_limitations: string;
}

/**
 * The `POST /api/analysis` response DTO. Discriminated on `status`: `"ok"`
 * carries the generated result plus the coverage it was based on; `"empty"`
 * signals a fully-empty window (no LLM call was made) so the UI shows guidance
 * to log more days.
 */
export type AnalysisResponse =
  | { status: "ok"; result: AnalysisResult; coverage: AnalysisCoverage }
  | { status: "empty"; coverage: AnalysisCoverage };
