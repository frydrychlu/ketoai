export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import type { AnalysisResponse } from "@/types";
import { ANALYSIS_WINDOWS } from "@/types";
import { createClient } from "@/lib/supabase";
import { gatherAnalysisWindow, requestAnalysis, AnalysisError } from "@/lib/services/analysis";

// The browser's local calendar date, ISO YYYY-MM-DD. The refine rejects
// structurally-valid but non-existent dates (mirrors the meals/biomarkers
// routes) so a bad value never reaches the range read. The client sends its
// LOCAL today as `to` — deriving the window server-side from a UTC clock would
// drift a day from the local `day` values the loggers write near midnight.
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Nieprawidłowa data")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Nieprawidłowa data");

const analysisRequestSchema = z.object({
  // window_days must be one of the fixed presets (7/14/30). z.literal per value
  // keeps the enum in sync with ANALYSIS_WINDOWS (the island's selector source).
  window_days: z.union(ANALYSIS_WINDOWS.map((n) => z.literal(n)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]),
  to: daySchema,
});

/** Subtract `days` from an ISO YYYY-MM-DD date, returning ISO YYYY-MM-DD. */
function subtractDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

// POST /api/analysis — on-demand AI analysis of the last N days.
//   body: { window_days: 7 | 14 | 30, to: YYYY-MM-DD (client local today) }
// Aggregates the window, short-circuits a fully-empty window without calling the
// LLM, otherwise returns the validated structured analysis + coverage.
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

  const parsed = analysisRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }
  const { window_days, to } = parsed.data;
  const from = subtractDays(to, window_days - 1);

  let window;
  try {
    window = await gatherAnalysisWindow(supabase, from, to);
  } catch {
    return Response.json({ error: "Could not load analysis data" }, { status: 500 });
  }

  // Empty-window gate: no data of any type → skip the LLM call and tell the UI
  // to show the "log more days" guidance. A window with ANY data proceeds and
  // lets the model hedge via the coverage facts.
  if (!window.coverage.hasAnyData) {
    return Response.json({ status: "empty", coverage: window.coverage } satisfies AnalysisResponse);
  }

  try {
    const result = await requestAnalysis(window);
    return Response.json({ status: "ok", result, coverage: window.coverage } satisfies AnalysisResponse);
  } catch (error) {
    if (error instanceof AnalysisError) {
      return Response.json(
        { error: "Nie udało się wygenerować analizy. Spróbuj ponownie za chwilę." },
        { status: 422 },
      );
    }
    throw error;
  }
};
