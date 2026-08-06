-- Risk #7 (test-plan.md §2): health_goals is the only free-text field that
-- reaches the FR-012 analysis prompt with no bound at any layer — not the
-- textarea, not Zod, not the database. It is a singleton re-sent in full on
-- every analysis request, at every window size, so capping the window (N)
-- does not close this gap. Mirrors wellness_entries_notes_check
-- (20260630120002_wellness_entries.sql:45), the sibling free-text field that
-- already carries this bound. Forward-only (AGENTS.md): a new migration, not
-- an edit to 20260617072330_health_profiles.sql.

alter table public.health_profiles
  add constraint health_profiles_health_goals_check check (char_length(health_goals) <= 2000);
