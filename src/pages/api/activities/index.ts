export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import type { Activity } from "@/types";
import { createClient } from "@/lib/supabase";
import { estimateActivityCalories, ActivityEstimateError } from "@/lib/services/activity-estimate";
import { getDailyExpenditure, sumDailyExpenditure } from "@/lib/services/activities";

// The browser's local calendar date, ISO YYYY-MM-DD. The refine rejects
// structurally-valid but non-existent dates (e.g. 2026-13-45, 2026-02-30)
// so a bad value never reaches the LLM call or the `date`-column insert.
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Nieprawidłowa data")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Nieprawidłowa data");

const createActivitySchema = z.object({
  description: z.string().trim().min(1, "Opis aktywności jest wymagany"),
  day: daySchema,
});

// GET /api/activities?day=YYYY-MM-DD — the day's activities + expenditure total
// for the current user. The dashboard island calls this on mount with the
// browser's local date.
export const GET: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const parsed = daySchema.safeParse(new URL(context.request.url).searchParams.get("day"));
  if (!parsed.success) {
    return Response.json({ error: "Invalid day" }, { status: 400 });
  }

  const { data: activities, error } = await supabase
    .from("activities")
    .select("*")
    .eq("day", parsed.data)
    .order("logged_at", { ascending: true })
    .overrideTypes<Activity[], { merge: false }>();

  if (error) {
    return Response.json({ error: "Could not load activities" }, { status: 500 });
  }

  // Sum from the rows we already fetched — no need for a second query here.
  const total = sumDailyExpenditure(activities);
  return Response.json({ activities, total });
};

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

  const parsed = createActivitySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }
  const { description, day } = parsed.data;

  let calories_kcal: number;
  try {
    calories_kcal = await estimateActivityCalories(description);
  } catch (error) {
    if (error instanceof ActivityEstimateError) {
      return Response.json(
        { error: "Nie udało się oszacować spalonych kalorii. Spróbuj opisać aktywność inaczej." },
        { status: 422 },
      );
    }
    throw error;
  }

  // user_id must be set explicitly to satisfy the RLS `with check` policy.
  const insertResult = await supabase
    .from("activities")
    .insert({ user_id: user.id, description, day, calories_kcal })
    .select()
    .single();

  if (insertResult.error) {
    return Response.json({ error: "Could not save activity" }, { status: 500 });
  }

  const activity = insertResult.data as Activity;
  const total = await getDailyExpenditure(supabase, day);
  return Response.json({ activity, total }, { status: 201 });
};
