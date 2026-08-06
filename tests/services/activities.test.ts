import { describe, it, expect } from "vitest";
import { sumDailyExpenditure } from "@/lib/services/activities";

// Risk #4 (test-plan.md §2): getDailyExpenditure has no logic beyond
// sumDailyExpenditure(data) — structural twin of meals.ts's sumDailyTotal,
// including the same empty-day zero-fill contract.

describe("sumDailyExpenditure — empty-day zero-fill (risk #4)", () => {
  it("zero-fills a day with no activities", () => {
    expect(sumDailyExpenditure([])).toEqual({ calories_kcal: 0 });
  });

  it("sums multiple activities for a non-empty day", () => {
    const rows = [{ calories_kcal: 150 }, { calories_kcal: 220 }];

    expect(sumDailyExpenditure(rows)).toEqual({ calories_kcal: 370 });
  });
});
