<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Biomarker Logging with Automatic GKI (S-03)

- **Plan**: context/changes/biomarker-gki-logging/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-07-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Evidence

- **Automated verification**: repo-wide `npx astro sync && npm run lint` → exit 0 and `astro build` → `Complete!` (run during the S-02 review on the same tree; covers this code). Matches plan Progress SHAs 0f3c12d / d6390e5 / 995a890.
- **Migration** (`supabase/migrations/20260630120001_biomarker_readings.sql`): blends the meals `day date not null` column with the profile singleton — `unique (user_id, day)` as the upsert conflict target — and copies the `isolation_canary` RLS pattern verbatim (four granular `to authenticated` policies keyed on `auth.uid() = user_id`, writes with `with check`). `check (ketones_mmol_l > 0 and <= 20)` is the div-by-zero guard; `check (glucose_mg_dl between 20 and 600)`. `gki numeric not null` stored. The `unique (user_id, day)` index doubles as the daily lookup index (no separate index), as planned.
- **Service** (`src/lib/services/biomarkers.ts`): `computeGki` is a pure, unrounded, reusable function assuming `ketones > 0` (precondition enforced upstream). `getReading` uses `.maybeSingle()`. `upsertReading` computes `gki`, lists every column explicitly (mirrors `upsertProfile`), sets `user_id` from the session, `updated_at` explicitly, `{ onConflict: "user_id,day" }`.
- **API route** (`src/pages/api/biomarkers/index.ts`): `prerender = false`; shared `daySchema` (regex + real-date refine, identical to meals); `upsertBiomarkerSchema` with `gki` intentionally absent and bounds mirroring the DB CHECKs; 401 (no user) / 500 (unconfigured) guards on all handlers; POST returns 201 with `z.flattenError` fieldErrors on 400; DELETE returns 200/404. (The `?from=&to=` range branch + `listReadings` were added later by S-06 `57813a2`, not this slice — out of S-03 scope, already reviewed under S-06.)
- **Island** (`src/components/biomarkers/BiomarkerLogger.tsx`): mirrors `MealLogger` — `localDay()` (duplicated by design, documented), mount fetch with `AbortController`, client-side range guard before POST, GKI displayed in place rounded to 1 decimal, `Trash2` delete/clear. Polish user-facing strings match the meals-route precedent.
- **Types** (`src/types.ts`): `BiomarkerReading` + `UpsertBiomarkerReadingCommand` (no `gki` in the command) match the migration columns. Dashboard mounts `<BiomarkerLogger client:load />` under a "Biomarkers" heading. RLS proof recipe present (`supabase/tests/biomarker_readings_rls.sql`) with formula-consistent seed data.

## Findings

### F1 — Plan bookkeeping doesn't reflect shipped reality

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/biomarker-gki-logging/plan.md:415 + change.md:4
- **Detail**: All Manual verification checkboxes in the plan's Progress are still `- [ ]`, and change.md said `status: planned` — yet the feature is fully implemented, committed (0f3c12d/d6390e5/995a890), merged, and already depended upon by the shipped S-06 trends dashboard. The Phase-1 DB/RLS automated checks (1.1–1.3) are unchecked because they need the Docker DB. This is record drift, not missing work, but it means the archive gate will warn and the plan can't be trusted as ground truth by future reviews.
- **Fix**: Reconcile the record — this review bumps change.md to `impl_reviewed`; optionally tick the manual Progress items the code/commits evidence.
- **Decision**: PENDING

### F2 — DELETE uses maybeSingle() instead of the planned single()

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/biomarkers.ts:107
- **Detail**: Plan specified `.delete().eq("day", day).select().single()`; implementation uses `.maybeSingle()` and returns `data !== null`. Beneficial deviation — `.single()` throws on the zero-row (already-deleted) case, whereas `.maybeSingle()` cleanly yields the 404-vs-200 distinction the route needs.
- **Fix**: None — accept as an improvement over the plan.
- **Decision**: PENDING
