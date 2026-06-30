import type { SupabaseClient } from "@supabase/supabase-js";
import type { BiomarkerReading, UpsertBiomarkerReadingCommand } from "@/types";

/**
 * Compute the glycemic-ketone index (GKI) from a glucose (mg/dL) and ketone
 * (mmol/L) reading: `(glucoseMgDl / 18) / ketonesMmolL`.
 *
 * Pure and unrounded — the caller/display layer rounds. Assumes
 * `ketonesMmolL > 0`; that precondition is enforced upstream (Zod `min(0.1)`
 * and the DB `check (ketones_mmol_l > 0)`), not inside this function, so it
 * never divides by zero. Kept pure so S-06/S-09 can reuse the exact formula.
 */
export function computeGki(glucoseMgDl: number, ketonesMmolL: number): number {
  return glucoseMgDl / 18 / ketonesMmolL;
}

/**
 * Read the current user's biomarker reading for a single calendar day, or null
 * when none exists. RLS scopes the query to the logged-in user, so no explicit
 * user_id filter is needed. `.maybeSingle()` returns null (not an error) for the
 * no-row case.
 */
export async function getReading(supabase: SupabaseClient, day: string): Promise<BiomarkerReading | null> {
  const { data, error } = await supabase
    .from("biomarker_readings")
    .select("*")
    .eq("day", day)
    .maybeSingle<BiomarkerReading>();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Insert-or-update the current user's singleton reading for a day, keyed on the
 * `unique (user_id, day)` constraint. The GKI is computed here from the inputs
 * and stored — never user-supplied.
 *
 * Every column is listed explicitly (mirroring `upsertProfile`) — never spread a
 * partial object. `user_id` is set from the caller's id to satisfy the RLS
 * `with check`. `updated_at` is set explicitly because the column default fires
 * only on insert.
 */
export async function upsertReading(
  supabase: SupabaseClient,
  userId: string,
  data: UpsertBiomarkerReadingCommand,
): Promise<BiomarkerReading> {
  const gki = computeGki(data.glucose_mg_dl, data.ketones_mmol_l);

  const { data: row, error } = await supabase
    .from("biomarker_readings")
    .upsert(
      {
        user_id: userId,
        day: data.day,
        ketones_mmol_l: data.ketones_mmol_l,
        glucose_mg_dl: data.glucose_mg_dl,
        gki,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,day" },
    )
    .select()
    .single<BiomarkerReading>();

  if (error) {
    throw error;
  }

  return row;
}

/**
 * Delete the current user's reading for a day. RLS `using (auth.uid() = user_id)`
 * scopes the delete to the caller's own row — a day with no row (or another
 * user's day) simply affects zero rows. Returns whether a row was removed (for
 * the route's 404-vs-200 distinction).
 */
export async function deleteReading(supabase: SupabaseClient, day: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("biomarker_readings")
    .delete()
    .eq("day", day)
    .select()
    .maybeSingle<BiomarkerReading>();

  if (error) {
    throw error;
  }

  return data !== null;
}
