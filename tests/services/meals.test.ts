import { describe, it, expect } from "vitest";
import { sumDailyTotal } from "@/lib/services/meals";

// Risk #4 (test-plan.md §2): getDailyTotal has no logic beyond
// sumDailyTotal(data), so testing the pure reduce directly is a complete
// proof of its empty-day behavior: zero-fill, never null/undefined/throw.

describe("sumDailyTotal — empty-day zero-fill (risk #4)", () => {
  it("zero-fills a day with no meals", () => {
    expect(sumDailyTotal([])).toEqual({ fat_g: 0, protein_g: 0, carbs_g: 0, calories_kcal: 0 });
  });

  it("sums multiple meals for a non-empty day", () => {
    const rows = [
      { fat_g: 10, protein_g: 20, carbs_g: 5, calories_kcal: 210 },
      { fat_g: 5, protein_g: 10, carbs_g: 2, calories_kcal: 98 },
    ];

    expect(sumDailyTotal(rows)).toEqual({ fat_g: 15, protein_g: 30, carbs_g: 7, calories_kcal: 308 });
  });
});
