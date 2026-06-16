export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import type { Meal } from "@/types";
import { createClient } from "@/lib/supabase";
import { parseMealToMacros, MacroParseError } from "@/lib/services/macros";
import { getDailyTotal } from "@/lib/services/meals";

const createMealSchema = z.object({
  description: z.string().trim().min(1, "Opis posiłku jest wymagany"),
  // The browser's local calendar date, ISO YYYY-MM-DD.
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Nieprawidłowa data"),
});

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createMealSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }
  const { description, day } = parsed.data;

  let macros;
  try {
    macros = await parseMealToMacros(description);
  } catch (error) {
    if (error instanceof MacroParseError) {
      return Response.json(
        { error: "Nie udało się rozpoznać makroskładników. Spróbuj opisać posiłek inaczej." },
        { status: 422 },
      );
    }
    throw error;
  }

  // user_id must be set explicitly to satisfy the RLS `with check` policy.
  const insertResult = await supabase
    .from("meals")
    .insert({ user_id: user.id, description, day, ...macros })
    .select()
    .single();

  if (insertResult.error) {
    return Response.json({ error: "Could not save meal" }, { status: 500 });
  }

  const meal = insertResult.data as Meal;
  const total = await getDailyTotal(supabase, day);
  return Response.json({ meal, total }, { status: 201 });
};
