export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getReading, upsertReading, deleteReading } from "@/lib/services/biomarkers";

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

// GET /api/biomarkers?day=YYYY-MM-DD — the day's reading for the current user,
// or null. The dashboard island calls this on mount with the browser's local date.
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
