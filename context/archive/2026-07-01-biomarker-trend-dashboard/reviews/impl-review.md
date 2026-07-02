<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Biomarker Trend Dashboard (S-06)

- **Plan**: context/changes/biomarker-trend-dashboard/plan.md
- **Scope**: All 3 phases
- **Date**: 2026-07-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria re-run at review time: `npm run lint` clean, `npm run build` passes, `package.json`/lock unchanged (no charting dependency). Plan-file list and branch diff (`main...HEAD`) match exactly — no unplanned or missing files. All manual criteria confirmed by the user across the three phase gates.

## Findings

### F1 — Planned tooltip/value-label rounding not implemented

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/biomarkers/LineChart.tsx
- **Detail**: Phase 3 change #2 contract said "Values rounded for tooltip/label display via a round1-style helper." The charts render no per-point tooltips or value labels — only axis ticks (rounded by `formatTick`). Benign scope reduction (hand-rolled SVG tooltips are non-trivial); manual criterion 3.4 is met via axis ticks, but it's a real drop vs. the written plan.
- **Fix**: Accept as-is (axis ticks suffice for a trend view), or file a follow-up for hover tooltips if per-point readout is wanted.
- **Decision**: SAVED — untriaged

### F2 — Loading spinner can flicker off during rapid range switching

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/components/biomarkers/BiomarkerTrends.tsx:83-88
- **Detail**: On a range switch the old request is aborted; its rejected promise still runs `finally { setLoading(false) }`, which can land after the new effect set loading=true, briefly clearing the spinner while the new fetch is in flight. Purely cosmetic — the new request's own finally restores correct state and no wrong data renders. Same pattern exists in BiomarkerLogger (consistent, not novel).
- **Fix**: Guard the finally with `if (!controller.signal.aborted)` before `setLoading(false)`.
- **Decision**: SAVED — untriaged

### F3 — Band-legend swatch color derived by regex string replace

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/biomarkers/BiomarkerTrends.tsx:179
- **Detail**: The legend swatch opacity is bumped via `band.color.replace(/0\.\d+/, "0.9")` on the CSS color string. Works for the current `rgb(... / 0.NN)` format but silently breaks if a band color is expressed differently (hex, named) — a small coupling to the exact string shape.
- **Fix**: Give each band an explicit `swatch` color (or store opacity separately) instead of pattern-matching the fill string.
- **Decision**: SAVED — untriaged
