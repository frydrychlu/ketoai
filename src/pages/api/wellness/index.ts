export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getEntry, upsertEntry, deleteEntry } from "@/lib/services/wellness";

// The browser's local calendar date, ISO YYYY-MM-DD. The refine rejects
// structurally-valid but non-existent dates (e.g. 2026-13-45, 2026-02-30)
// so a bad value never reaches the `date`-column insert. Identical to the
// biomarkers/meals route daySchema.
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Nieprawidłowa data")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Nieprawidłowa data");

// A subjective 1–10 self-rating; nullable (every wellness field is optional).
const ratingSchema = z.number().int().min(1).max(10).nullable();

// Body for an upsert. Every wellness field is nullable so the user may save any
// subset (partial save). The numeric bounds mirror the DB CHECK constraints
// (ratings 1..10, water 0..20, notes <= 2000). An empty/whitespace `notes`
// string is normalized to null. The top-level refine requires AT LEAST ONE
// field to be non-null — a fully-empty body is rejected (clearing the whole day
// is the DELETE path, not an empty upsert).
const upsertWellnessSchema = z
  .object({
    day: daySchema,
    mood: ratingSchema,
    energy: ratingSchema,
    sleep_quality: ratingSchema,
    water_liters: z.number().min(0).max(20).nullable(),
    notes: z
      .string()
      .max(2000)
      .nullable()
      .transform((s) => {
        if (s === null) return null;
        const trimmed = s.trim();
        return trimmed.length === 0 ? null : trimmed;
      }),
  })
  .refine(
    (v) =>
      v.mood !== null || v.energy !== null || v.sleep_quality !== null || v.water_liters !== null || v.notes !== null,
    { message: "Wypełnij przynajmniej jedno pole." },
  );

// GET /api/wellness?day=YYYY-MM-DD — the day's entry for the current user, or
// null. The dashboard island calls this on mount with the browser's local date.
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
    const entry = await getEntry(supabase, parsed.data);
    return Response.json({ entry });
  } catch {
    return Response.json({ error: "Could not load entry" }, { status: 500 });
  }
};

// POST /api/wellness — upsert the day's entry (partial save). Re-posting the same
// day overwrites the singleton row; a field sent as null clears that column.
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

  const parsed = upsertWellnessSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }

  try {
    // user_id is set from the session to satisfy the RLS `with check` — never
    // trust a client-supplied owner.
    const entry = await upsertEntry(supabase, user.id, parsed.data);
    return Response.json({ entry }, { status: 201 });
  } catch {
    return Response.json({ error: "Could not save entry" }, { status: 500 });
  }
};

// DELETE /api/wellness?day=YYYY-MM-DD — clear the day's entry. RLS scopes the
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
    const removed = await deleteEntry(supabase, parsed.data);
    if (!removed) {
      return Response.json({ error: "Entry not found" }, { status: 404 });
    }
    return Response.json({ ok: true }, { status: 200 });
  } catch {
    return Response.json({ error: "Could not delete entry" }, { status: 500 });
  }
};
