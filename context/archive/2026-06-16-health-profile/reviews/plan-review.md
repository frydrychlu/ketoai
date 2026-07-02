<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Health Profile (S-02)

- **Plan**: context/changes/health-profile/plan.md
- **Mode**: Deep
- **Date**: 2026-06-16
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 1 critical · 1 warning · 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | PASS |

## Grounding

8/8 paths ✓ (middleware, dashboard.astro, types.ts, supabase.ts, SignUpForm.tsx, signin.ts, isolation_canary migration, meals_rls.sql test), formData()+`context.redirect('?error=…')` pattern in signin.ts ✓, Progress↔Phase mechanical contract ✓, brief↔plan ✓.

## Findings

### F1 — Upsert won't NULL cleared fields on re-save

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details + Phase 2 (upsert)
- **Detail**: The plan mapped empty fields to `undefined`, then persisted with `.upsert({ user_id, ...data })`. supabase-js serializes to JSON (drops `undefined` keys) and PostgREST's `ON CONFLICT DO UPDATE` only writes columns present in the payload, so on an edit that clears a previously-saved field the column keeps its OLD value instead of being NULLed. Breaks success criteria 2.5, 3.6, and the Desired End State; passes a first-insert smoke test, fails on the second save.
- **Fix**: Map empty strings to explicit `null` (not `undefined`); make the Zod schema fields `.nullable()`; build the upsert object with all five columns (`age`, `weight_kg`, `height_cm`, `activity_level`, `health_goals`) always present, value-or-`null`. Keep explicit `updated_at: now` (default fires only on insert).
- **Decision**: FIXED (Fix in plan — edited Critical Implementation Details, `upsertProfile` contract, and the route formData/Zod contract)

### F2 — Validation error discards all typed input

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 (error redirect) + Phase 3 (ProfileForm)
- **Detail**: On server validation failure the route redirects to `/profile?error=…` and the page re-prefills from the DB via getProfile, discarding the user's just-typed values. With five fields, one bad number wipes the whole form. The plan made client-side range hints "optional"/non-blocking, making the lossy server path primary.
- **Fix A ⭐ Recommended**: Make client-side validation block submit (mirror `SignUpForm.handleSubmit` → `validate()` + `preventDefault`) so out-of-range never reaches the server.
  - Strength: Proven by SignUpForm; input never lost; server stays backstop; low effort.
  - Tradeoff: Duplicates range bounds on the client (keep in sync with the Zod schema).
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Fix B**: Echo submitted values back through the redirect/SSR.
  - Strength: Server stays sole source of truth; no duplicated bounds.
  - Tradeoff: More plumbing than the auth pattern; free-text goals need encoding.
  - Confidence: MED.
  - Blind spot: Query-string round-trip of free text.
- **Decision**: FIXED (Fix A — Phase 3 ProfileForm contract now blocks submit on out-of-range and marks the field inline)

### F3 — "Inline error" is actually a single banner

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Desired End State + Phase 3
- **Detail**: The end state described out-of-range rejection "with an inline error," but the server mechanism carries one message in `?error=` surfaced as a `ServerError` banner — not bound to a field. With F2's Fix A, the client now does mark the bad field inline before submit, so the server path is a banner backstop.
- **Fix**: Reword the end state — client-side shows the inline field error blocking submit; the server path shows an error banner.
- **Decision**: FIXED (Fix in plan — Desired End State reworded)
