import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyMacroSeriesPoint, DailyMacroTotal, Meal } from "@/types";

type MacroRow = Pick<Meal, "fat_g" | "protein_g" | "carbs_g" | "calories_kcal">;
type DatedMacroRow = MacroRow & Pick<Meal, "day">;

/** Sum macro rows into a daily total. Pure — reuse when the rows are already in hand. */
export function sumDailyTotal(rows: MacroRow[]): DailyMacroTotal {
  return rows.reduce<DailyMacroTotal>(
    (acc, row) => ({
      fat_g: acc.fat_g + row.fat_g,
      protein_g: acc.protein_g + row.protein_g,
      carbs_g: acc.carbs_g + row.carbs_g,
      calories_kcal: acc.calories_kcal + row.calories_kcal,
    }),
    { fat_g: 0, protein_g: 0, carbs_g: 0, calories_kcal: 0 },
  );
}

/**
 * Sum the current user's meals for a single calendar day into a macro total.
 * RLS scopes the query to the logged-in user, so no explicit user_id filter is
 * needed — the SSR client already runs as that user.
 */
export async function getDailyTotal(supabase: SupabaseClient, day: string): Promise<DailyMacroTotal> {
  const { data, error } = await supabase
    .from("meals")
    .select("fat_g, protein_g, carbs_g, calories_kcal")
    .eq("day", day)
    .overrideTypes<MacroRow[], { merge: false }>();

  if (error) {
    throw error;
  }

  return sumDailyTotal(data);
}

/**
 * Aggregate the current user's meals into one macro total per day across an
 * inclusive `[from, to]` calendar-date range — the diet series the trends
 * dashboard charts. PostgREST has no convenient GROUP BY, so rows are fetched in
 * range and folded per day in JS with the pure `sumDailyTotal`. Only days that
 * have meals appear (no zero rows); the result is ordered by day ascending. RLS
 * scopes the query to the logged-in user, so no explicit user_id filter is needed
 * (mirrors `getDailyTotal`). `from`/`to` are ISO `YYYY-MM-DD`; the caller
 * guarantees `from <= to`.
 */
export async function listDailyTotals(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<DailyMacroSeriesPoint[]> {
  const { data, error } = await supabase
    .from("meals")
    .select("day, fat_g, protein_g, carbs_g, calories_kcal")
    .gte("day", from)
    .lte("day", to)
    .order("day", { ascending: true })
    .overrideTypes<DatedMacroRow[], { merge: false }>();

  if (error) {
    throw error;
  }

  // Rows arrive ordered by day, so group runs of the same day together. A Map
  // keyed on day preserves insertion (ascending) order for the final series.
  const byDay = new Map<string, MacroRow[]>();
  for (const row of data) {
    const rows = byDay.get(row.day);
    if (rows) {
      rows.push(row);
    } else {
      byDay.set(row.day, [row]);
    }
  }

  return Array.from(byDay, ([day, rows]) => ({ day, ...sumDailyTotal(rows) }));
}
