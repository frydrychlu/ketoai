import type { SupabaseClient } from "@supabase/supabase-js";
import type { WellnessEntry, UpsertWellnessEntryCommand } from "@/types";

/**
 * Read the current user's wellness entry for a single calendar day, or null
 * when none exists. RLS scopes the query to the logged-in user, so no explicit
 * user_id filter is needed. `.maybeSingle()` returns null (not an error) for the
 * no-row case.
 */
export async function getEntry(supabase: SupabaseClient, day: string): Promise<WellnessEntry | null> {
  const { data, error } = await supabase
    .from("wellness_entries")
    .select("*")
    .eq("day", day)
    .maybeSingle<WellnessEntry>();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Insert-or-update the current user's singleton wellness entry for a day, keyed
 * on the `unique (user_id, day)` constraint.
 *
 * Every column is listed explicitly (value or null) — never spread a partial
 * object. PostgREST's ON CONFLICT DO UPDATE only writes columns present in the
 * payload, so a blanked field sent as `null` here NULLs the column on re-save
 * instead of keeping its OLD value (mirrors `upsertProfile`). `user_id` is set
 * from the caller's id to satisfy the RLS `with check`. `updated_at` is set
 * explicitly because the column default fires only on insert.
 */
export async function upsertEntry(
  supabase: SupabaseClient,
  userId: string,
  data: UpsertWellnessEntryCommand,
): Promise<WellnessEntry> {
  const { data: row, error } = await supabase
    .from("wellness_entries")
    .upsert(
      {
        user_id: userId,
        day: data.day,
        mood: data.mood,
        energy: data.energy,
        sleep_quality: data.sleep_quality,
        water_liters: data.water_liters,
        notes: data.notes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,day" },
    )
    .select()
    .single<WellnessEntry>();

  if (error) {
    throw error;
  }

  return row;
}

/**
 * Delete the current user's wellness entry for a day. RLS `using (auth.uid() =
 * user_id)` scopes the delete to the caller's own row — a day with no row (or
 * another user's day) simply affects zero rows. Returns whether a row was
 * removed (for the route's 404-vs-200 distinction).
 */
export async function deleteEntry(supabase: SupabaseClient, day: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("wellness_entries")
    .delete()
    .eq("day", day)
    .select()
    .maybeSingle<WellnessEntry>();

  if (error) {
    throw error;
  }

  return data !== null;
}
