export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import type { Meal } from "@/types";
import { createClient } from "@/lib/supabase";
import { parseMealToMacros, MacroParseError } from "@/lib/services/macros";
import { getDailyTotal, listDailyTotals, sumDailyTotal } from "@/lib/services/meals";

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

const createMealSchema = z.object({
  description: z.string().trim().min(1, "Opis posiłku jest wymagany"),
  day: daySchema,
});

// The trends dashboard never needs a window wider than 30 days; cap the span
// well above that (a year) so a hand-typed request can't trigger an unbounded
// scan, while never rejecting a legitimate window. Mirrors the biomarkers route.
const MAX_RANGE_DAYS = 366;

// GET /api/meals
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD — the current user's per-day macro totals
//     across the inclusive range, ordered by day (the trends dashboard calls this).
//   ?day=YYYY-MM-DD — the day's meals + macro total (the dashboard logger).
// The range branch takes precedence when both `from` and `to` are present.
export const GET: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const params = new URL(context.request.url).searchParams;
  const fromParam = params.get("from");
  const toParam = params.get("to");

  // Range branch: both `from` and `to` must be valid dates with from <= to and a
  // span within the cap. Mirrors the biomarkers route's range branch.
  if (fromParam !== null || toParam !== null) {
    const from = daySchema.safeParse(fromParam);
    const to = daySchema.safeParse(toParam);
    if (!from.success || !to.success) {
      return Response.json({ error: "Invalid range" }, { status: 400 });
    }
    // ISO YYYY-MM-DD compares lexicographically the same as chronologically.
    if (from.data > to.data) {
      return Response.json({ error: "Invalid range" }, { status: 400 });
    }
    const spanDays = (Date.parse(`${to.data}T00:00:00Z`) - Date.parse(`${from.data}T00:00:00Z`)) / 86_400_000;
    if (spanDays > MAX_RANGE_DAYS) {
      return Response.json({ error: "Range too wide" }, { status: 400 });
    }

    try {
      const dailyTotals = await listDailyTotals(supabase, from.data, to.data);
      return Response.json({ dailyTotals });
    } catch {
      return Response.json({ error: "Could not load meals" }, { status: 500 });
    }
  }

  // Single-day branch (unchanged).
  const parsed = daySchema.safeParse(params.get("day"));
  if (!parsed.success) {
    return Response.json({ error: "Invalid day" }, { status: 400 });
  }

  const { data: meals, error } = await supabase
    .from("meals")
    .select("*")
    .eq("day", parsed.data)
    .order("logged_at", { ascending: true })
    .overrideTypes<Meal[], { merge: false }>();

  if (error) {
    return Response.json({ error: "Could not load meals" }, { status: 500 });
  }

  // Sum from the rows we already fetched — no need for a second query here.
  const total = sumDailyTotal(meals);
  return Response.json({ meals, total });
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
