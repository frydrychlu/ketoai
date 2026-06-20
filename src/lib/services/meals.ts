import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyMacroTotal, Meal } from "@/types";

type MacroRow = Pick<Meal, "fat_g" | "protein_g" | "carbs_g" | "calories_kcal">;

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
