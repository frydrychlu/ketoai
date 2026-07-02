import type { SupabaseClient } from "@supabase/supabase-js";
import type { Activity, DailyExpenditureSeriesPoint, DailyExpenditureTotal } from "@/types";

type ExpenditureRow = Pick<Activity, "calories_kcal">;
type DatedExpenditureRow = ExpenditureRow & Pick<Activity, "day">;

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

/**
 * Aggregate the current user's activities into one caloric-expenditure total per
 * day across an inclusive `[from, to]` calendar-date range — the activity series
 * the trends dashboard charts. PostgREST has no convenient GROUP BY, so rows are
 * fetched in range and folded per day in JS with the pure `sumDailyExpenditure`.
 * Only days that have activities appear (no zero rows); the result is ordered by
 * day ascending. RLS scopes the query to the logged-in user, so no explicit
 * user_id filter is needed (mirrors `getDailyExpenditure`). `from`/`to` are ISO
 * `YYYY-MM-DD`; the caller guarantees `from <= to`.
 */
export async function listDailyExpenditure(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<DailyExpenditureSeriesPoint[]> {
  const { data, error } = await supabase
    .from("activities")
    .select("day, calories_kcal")
    .gte("day", from)
    .lte("day", to)
    .order("day", { ascending: true })
    .overrideTypes<DatedExpenditureRow[], { merge: false }>();

  if (error) {
    throw error;
  }

  // Rows arrive ordered by day, so group runs of the same day together. A Map
  // keyed on day preserves insertion (ascending) order for the final series.
  const byDay = new Map<string, ExpenditureRow[]>();
  for (const row of data) {
    const rows = byDay.get(row.day);
    if (rows) {
      rows.push(row);
    } else {
      byDay.set(row.day, [row]);
    }
  }

  return Array.from(byDay, ([day, rows]) => ({ day, ...sumDailyExpenditure(rows) }));
}
