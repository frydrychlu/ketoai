export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { ACTIVITY_LEVELS } from "@/types";
import { upsertProfile } from "@/lib/services/profile";

// Every field is nullable — partial saves are allowed and a cleared field is sent
// as explicit null. Ranges mirror the DB CHECK constraints; the activity enum is
// sourced from ACTIVITY_LEVELS so route, DB CHECK, and form options stay in sync.
const updateHealthProfileSchema = z.object({
  age: z.number().int().min(13).max(120).nullable(),
  weight_kg: z.number().min(20).max(500).nullable(),
  height_cm: z.number().min(50).max(250).nullable(),
  activity_level: z.enum(ACTIVITY_LEVELS).nullable(),
  health_goals: z.string().min(1).nullable(),
});

/** Read a form field, trim it, and treat an empty string as "leave blank" (null). */
function str(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Coerce a form field to a number, or null when blank. Non-numeric → NaN, rejected by Zod. */
function num(form: FormData, key: string): number | null {
  const value = str(form, key);
  return value === null ? null : Number(value);
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/profile?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const form = await context.request.formData();
  const raw = {
    age: num(form, "age"),
    weight_kg: num(form, "weight_kg"),
    height_cm: num(form, "height_cm"),
    activity_level: str(form, "activity_level"),
    health_goals: str(form, "health_goals"),
  };

  const parsed = updateHealthProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = `${issue.path.join(".")}: ${issue.message}`;
    return context.redirect(`/profile?error=${encodeURIComponent(message)}`);
  }

  try {
    await upsertProfile(supabase, user.id, parsed.data);
  } catch {
    return context.redirect(`/profile?error=${encodeURIComponent("Nie udało się zapisać profilu")}`);
  }

  return context.redirect("/profile?saved=1");
};
