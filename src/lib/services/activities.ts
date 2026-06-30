import type { SupabaseClient } from "@supabase/supabase-js";
import type { Activity, DailyExpenditureTotal } from "@/types";

type ExpenditureRow = Pick<Activity, "calories_kcal">;

/** Sum activity rows into a daily expenditure total. Pure — reuse when rows are in hand. */
export function sumDailyExpenditure(rows: ExpenditureRow[]): DailyExpenditureTotal {
  return rows.reduce<DailyExpenditureTotal>((acc, row) => ({ calories_kcal: acc.calories_kcal + row.calories_kcal }), {
    calories_kcal: 0,
  });
}

/**
 * Sum the current user's activities for a single calendar day into an expenditure
 * total. RLS scopes the query to the logged-in user, so no explicit user_id filter
 * is needed — the SSR client already runs as that user.
 */
export async function getDailyExpenditure(supabase: SupabaseClient, day: string): Promise<DailyExpenditureTotal> {
  const { data, error } = await supabase
    .from("activities")
    .select("calories_kcal")
    .eq("day", day)
    .overrideTypes<ExpenditureRow[], { merge: false }>();

  if (error) {
    throw error;
  }

  return sumDailyExpenditure(data);
}
