export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import type { Meal } from "@/types";
import { createClient } from "@/lib/supabase";
import { getDailyTotal } from "@/lib/services/meals";

const uuidSchema = z.uuid();

export const DELETE: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idResult = uuidSchema.safeParse(context.params.id);
  if (!idResult.success) {
    return Response.json({ error: "Invalid meal id" }, { status: 400 });
  }
  const id = idResult.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  // RLS `using (auth.uid() = user_id)` means a user can only delete their own
  // row — deleting someone else's id simply affects zero rows (-> 404 below).
  const deleteResult = await supabase.from("meals").delete().eq("id", id).select().single();

  if (deleteResult.error || !deleteResult.data) {
    return Response.json({ error: "Meal not found" }, { status: 404 });
  }

  const deleted = deleteResult.data as Meal;
  const total = await getDailyTotal(supabase, deleted.day);
  return Response.json({ total }, { status: 200 });
};
