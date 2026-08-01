import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalysisCoverage, AnalysisWindow } from "@/types";
import { listDailyTotals } from "./meals";
import { listDailyExpenditure } from "./activities";
import { listReadings } from "./biomarkers";
import { listEntries } from "./wellness";
import { getProfile } from "./profile";

/**
 * On-demand AI analysis service (S-09). This module assembles the N-day data
 * window the analysis reasons over and (in `analysis-client` / Phase 2) turns it
 * into a validated result via OpenRouter.
 */

/** Whole calendar days between two inclusive ISO `YYYY-MM-DD` dates, plus one. */
function inclusiveDaySpan(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Gather the current user's data for the inclusive `[from, to]` window and
 * compute per-type day coverage. Every read is RLS-scoped to the logged-in user
 * (the SSR client runs as that user), so the assembled window can only ever
 * contain the requesting user's own data — the FR-012 isolation guardrail is
 * enforced structurally, not by a filter here. Reads run in parallel.
 *
 * Meals and activities arrive pre-aggregated to daily totals (one point per day
 * with data); biomarkers and wellness are one row per day. Coverage counts are
 * therefore the array lengths. `hasAnyData` is false only when no data type has
 * a single day — a profile alone does not count as analyzable data.
 *
 * `from`/`to` are ISO `YYYY-MM-DD`; the caller guarantees `from <= to`.
 */
export async function gatherAnalysisWindow(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<AnalysisWindow> {
  const [profile, meals, activities, biomarkers, wellness] = await Promise.all([
    getProfile(supabase),
    listDailyTotals(supabase, from, to),
    listDailyExpenditure(supabase, from, to),
    listReadings(supabase, from, to),
    listEntries(supabase, from, to),
  ]);

  const coverage: AnalysisCoverage = {
    totalDays: inclusiveDaySpan(from, to),
    mealDays: meals.length,
    activityDays: activities.length,
    biomarkerDays: biomarkers.length,
    wellnessDays: wellness.length,
    hasProfile: profile !== null,
    hasAnyData: meals.length > 0 || activities.length > 0 || biomarkers.length > 0 || wellness.length > 0,
  };

  return { profile, meals, activities, biomarkers, wellness, coverage };
}
