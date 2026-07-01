export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getReading, listReadings, upsertReading, deleteReading } from "@/lib/services/biomarkers";

// The browser's local calendar date, ISO YYYY-MM-DD. The refine rejects
// structurally-valid but non-existent dates (e.g. 2026-13-45, 2026-02-30)
// so a bad value never reaches the `date`-column insert. Identical to the
// meals route's daySchema.
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Nieprawidłowa data")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Nieprawidłowa data");

// Body for an upsert. `gki` is intentionally NOT here — the server computes it.
// The numeric bounds mirror the DB CHECK constraints (ketones > 0..20, glucose
// 20..600); `min(0.1)` keeps ketones just above zero so GKI never divides by zero.
const upsertBiomarkerSchema = z.object({
  day: daySchema,
  ketones_mmol_l: z.number().min(0.1).max(20),
  glucose_mg_dl: z.number().int().min(20).max(600),
});

// The widest range the trends dashboard ever needs is 30 days; cap the span
// well above that (a year) so a hand-typed request can't trigger an unbounded
// scan, while never rejecting a legitimate window.
const MAX_RANGE_DAYS = 366;

// GET /api/biomarkers
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD — the current user's readings across the
//     inclusive range, ordered by day (the trends dashboard calls this).
//   ?day=YYYY-MM-DD — the single day's reading, or null (the dashboard logger).
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

  // Range branch: both `from` and `to` must be valid dates with from <= to and
  // a span within the cap.
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
      const readings = await listReadings(supabase, from.data, to.data);
      return Response.json({ readings });
    } catch {
      return Response.json({ error: "Could not load readings" }, { status: 500 });
    }
  }

  // Single-day branch (unchanged).
  const parsed = daySchema.safeParse(params.get("day"));
  if (!parsed.success) {
    return Response.json({ error: "Invalid day" }, { status: 400 });
  }

  try {
    const reading = await getReading(supabase, parsed.data);
    return Response.json({ reading });
  } catch {
    return Response.json({ error: "Could not load reading" }, { status: 500 });
  }
};

// POST /api/biomarkers — upsert the day's reading. The server computes and stores
// the GKI; re-posting the same day overwrites the singleton row.
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

  const parsed = upsertBiomarkerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }

  try {
    // user_id is set from the session to satisfy the RLS `with check` — never
    // trust a client-supplied owner.
    const reading = await upsertReading(supabase, user.id, parsed.data);
    return Response.json({ reading }, { status: 201 });
  } catch {
    return Response.json({ error: "Could not save reading" }, { status: 500 });
  }
};

// DELETE /api/biomarkers?day=YYYY-MM-DD — clear the day's reading. RLS scopes the
// delete to the caller's own row, so a stray day removes nothing (-> 404).
export const DELETE: APIRoute = async (context) => {
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

  try {
    const removed = await deleteReading(supabase, parsed.data);
    if (!removed) {
      return Response.json({ error: "Reading not found" }, { status: 404 });
    }
    return Response.json({ ok: true }, { status: 200 });
  } catch {
    return Response.json({ error: "Could not delete reading" }, { status: 500 });
  }
};
