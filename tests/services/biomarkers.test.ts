import { describe, it, expect } from "vitest";
import { computeGki } from "@/lib/services/biomarkers";

// Risk #4 (test-plan.md §2): GKI must be correct at its boundaries, not only
// on the happy path. Each expected value is the PRD Business Logic rule 1
// formula — GKI = (glucose_mg_dL / 18) / ketones_mmol_L — worked out for the
// scenario's inputs, never copied from a prior computeGki() run.

describe("computeGki — formula and zero-ketone boundary (risk #4)", () => {
  it("computes GKI for a mid-range reading", () => {
    // glucose 90 mg/dL, ketones 3 mmol/L
    expect(computeGki(90, 3)).toBe(90 / 18 / 3);
  });

  it("computes GKI at the ketones floor Zod enforces (0.1 mmol/L)", () => {
    // glucose 20 mg/dL (Zod/DB floor), ketones 0.1 mmol/L (Zod floor)
    expect(computeGki(20, 0.1)).toBe(20 / 18 / 0.1);
  });

  it("computes GKI at the ketones ceiling Zod/DB enforce (20 mmol/L)", () => {
    // glucose 600 mg/dL (Zod/DB ceiling), ketones 20 mmol/L (Zod/DB ceiling)
    expect(computeGki(600, 20)).toBe(600 / 18 / 20);
  });
});
