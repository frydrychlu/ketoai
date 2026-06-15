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
