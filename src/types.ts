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
