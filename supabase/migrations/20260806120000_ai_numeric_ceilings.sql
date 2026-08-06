-- Risk #1 (test-plan.md §2): every user-typed physiological value in this
-- schema is bounded at both ends; every AI-derived numeric was bounded only
-- below (20260620075537_meals_macro_nonneg.sql closed the floor, never the
-- ceiling). Add DB-level CHECK ceilings so an out-of-range model value cannot
-- persist through any writer, including the live but unused
-- meals_update_own / activities_update_own RLS policies where Zod never runs.
-- Values mirror the Zod ceilings in macro-schema.ts and
-- activity-estimate-schema.ts. Forward-only (AGENTS.md): a new migration, not
-- an edit to an existing one.

alter table public.meals
  add constraint meals_fat_g_max check (fat_g <= 1000),
  add constraint meals_protein_g_max check (protein_g <= 1000),
  add constraint meals_carbs_g_max check (carbs_g <= 1000),
  add constraint meals_calories_kcal_max check (calories_kcal <= 10000);

alter table public.activities
  add constraint activities_calories_kcal_max check (calories_kcal <= 10000);
