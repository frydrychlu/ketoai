---
change_id: testing-deterministic-domain-math
title: Prove daily macro/GKI totals are correct at boundary inputs
status: implemented
created: 2026-08-06
updated: 2026-08-06
archived_at: null
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Deterministic domain math".
Risks covered: #4 - A daily macro total or GKI value is plausible but wrong at a boundary (zero ketones, a day with no entries, or an entry landing on the wrong calendar day). Test types planned: unit.
Risk response intent: prove that boundary inputs produce a defined, correct result - zero ketones, a day with no entries, and an entry at a day boundary - computed independently from PRD Business Logic rule 1, not copied from the implementation. Also carries an unresolved lead from Phase 1 research (2026-08-06, flagged for /10x-test-plan --refresh, not yet backported to the risk map): supabase/config.toml sets max_rows = 1000 and listDailyTotals/listDailyExpenditure fetch every row in range with no pagination, so a window past ~33 meals/day silently truncates with no error.
