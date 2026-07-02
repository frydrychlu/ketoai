<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Diet & Activity Correlation Visualizations (S-07)

- **Plan**: context/changes/diet-activity-correlation/plan.md
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-07-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

Changed files match the plan's file list exactly — no unplanned source files.
`npm run lint` ✅, `npm run build` ✅ (no new dependency). All Progress rows `[x]`
with matching diff evidence.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Ketones/glucose chart columns don't align with the bars

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency (alignment contract)
- **Location**: src/components/biomarkers/BarChart.tsx:58 vs src/components/biomarkers/LineChart.tsx:95
- **Detail**: The small-multiples contract is column alignment. The dual-axis ketones/glucose LineChart uses `padRight=48` (right axis) → plotW=548, while the GKI chart and both BarCharts use `padRight=16` → plotW=580. A given date lands ~32px inset on the ketones/glucose chart vs the bars/GKI. Bars DO align with the GKI hero (the plan's explicit anchor), but not with the dual-axis chart. The GKI-vs-dual mismatch is pre-existing S-06 geometry that S-07 inherits.
- **Fix A ⭐ Recommended**: Accept — anchor alignment to the GKI hero.
  - Strength: Bars align with GKI as planned; fixing the dual-axis inset means editing the biomarker charts, which this slice lists under "What We're NOT Doing."
  - Tradeoff: Scanning a bar to the ketones/glucose line is ~32px off; only GKI correlation is pixel-true.
  - Confidence: HIGH — geometry verified from the padding constants.
  - Blind spot: Whether users correlate ketones/glucose (not just GKI) against the bars.
- **Fix B**: Normalize plot width across all charts (follow-up).
  - Strength: True column alignment across all four charts.
  - Tradeoff: Requires symmetric L/R padding in LineChart too — scope creep into S-06 charts; can't be done in BarChart alone since GKI and dual already differ.
  - Confidence: MED — touches shared S-06 code with its own manual checks.
  - Blind spot: Ripple into existing GKI/dual rendering.
- **Decision**: PENDING

### F2 — Failed diet/activity fetch is shown as "no data"

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Safety & Quality (reliability/UX)
- **Location**: src/components/biomarkers/BiomarkerTrends.tsx:132-139
- **Detail**: A non-ok/500 from /api/meals or /api/activities leaves the series `[]` and renders the "Brak posiłków… Zaloguj posiłki" empty state — telling the user to log data when the fetch actually failed. The plan said "empty/unavailable state"; only the empty case is distinguished.
- **Fix**: Track a per-stream fetch-failure flag and show a "nie udało się wczytać" note instead of the log-CTA empty state on failure.
- **Decision**: PENDING

### F3 — Loading flicker on rapid range toggling (pre-existing pattern)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/components/biomarkers/BiomarkerTrends.tsx:143-145
- **Detail**: The aborted in-flight fetch's `finally { setLoading(false) }` can run (as a microtask) after the new effect has set loading=true, briefly dropping the spinner mid-load. Inherited verbatim from the S-06 island idiom the plan asked to mirror.
- **Fix**: In finally, guard with `if (!controller.signal.aborted) setLoading(false)`.
- **Decision**: PENDING

### F4 — All-empty fallback copy changed (plan said "unchanged")

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/biomarkers/BiomarkerTrends.tsx:210-213
- **Detail**: Plan Phase 3 change #4 said the "overall (all-streams-empty) fallback [is] unchanged," but the copy was updated from the biomarker-only message to "Zaloguj ketony, glukozę, posiłki i aktywność." A sensible improvement (the fallback now covers all three streams), just a deviation from the plan's stated intent worth recording.
- **Fix**: None needed — accept the improved copy; noted for the record.
- **Decision**: PENDING
