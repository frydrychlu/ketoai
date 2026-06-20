-- S-01 review follow-up (impl-review F10): defense-in-depth.
-- The app validates macros as >= 0 with Zod at the API boundary, but the table
-- itself accepted negative values from any future writer. Add DB-level CHECK
-- constraints so the non-negative invariant holds regardless of the writer.
-- Forward-only (AGENTS.md): a new migration, not an edit to 20260615182411_meals.sql.

alter table public.meals
  add constraint meals_fat_g_nonneg check (fat_g >= 0),
  add constraint meals_protein_g_nonneg check (protein_g >= 0),
  add constraint meals_carbs_g_nonneg check (carbs_g >= 0),
  add constraint meals_calories_kcal_nonneg check (calories_kcal >= 0);
