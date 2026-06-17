import type { SupabaseClient } from "@supabase/supabase-js";
import type { HealthProfile, UpdateHealthProfileCommand } from "@/types";

/**
 * Read the current user's health profile, or null when none exists yet.
 * RLS scopes the query to the logged-in user, so no explicit user_id filter is
 * needed. `.maybeSingle()` returns null (not an error) for the no-row case.
 */
export async function getProfile(supabase: SupabaseClient): Promise<HealthProfile | null> {
  const { data, error } = await supabase.from("health_profiles").select("*").maybeSingle<HealthProfile>();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Insert-or-update the current user's singleton profile, keyed on the
 * `unique (user_id)` constraint.
 *
 * Every column is listed explicitly (value or null) — never spread a partial
 * object. PostgREST's ON CONFLICT DO UPDATE only writes columns present in the
 * payload, so omitting a cleared field would keep its OLD value on re-save
 * instead of NULLing it. `updated_at` is set explicitly because the column
 * default fires only on insert.
 */
export async function upsertProfile(
  supabase: SupabaseClient,
  userId: string,
  data: UpdateHealthProfileCommand,
): Promise<HealthProfile> {
  const { data: row, error } = await supabase
    .from("health_profiles")
    .upsert(
      {
        user_id: userId,
        age: data.age,
        weight_kg: data.weight_kg,
        height_cm: data.height_cm,
        activity_level: data.activity_level,
        health_goals: data.health_goals,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select()
    .single<HealthProfile>();

  if (error) {
    throw error;
  }

  return row;
}
