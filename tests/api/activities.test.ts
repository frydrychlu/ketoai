import { describe, it, expect } from "vitest";
import { server } from "../setup";
import { buildApiContext } from "../helpers/api-context";
import { postgrestRows } from "../helpers/msw";
import { GET } from "@/pages/api/activities/index";

// Risk #4 (test-plan.md §2): listDailyExpenditure is activities.ts's
// structural twin of meals.ts's listDailyTotals — same empty-day omission
// contract, mirrored here per the decision to extend Phase 2's aggregation-
// asymmetry coverage to activities.

describe("GET /api/activities — empty-day omission, not zero-fill, in range results (risk #4)", () => {
  it("omits a day with no activities from the range result instead of returning a zero-filled entry", async () => {
    server.use(postgrestRows("activities", [{ day: "2026-08-01", calories_kcal: 150 }]));

    const response = await GET(
      buildApiContext({ method: "GET", url: "https://app.test/api/test?from=2026-08-01&to=2026-08-02" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dailyExpenditures).toEqual([{ day: "2026-08-01", calories_kcal: 150 }]);
  });
});

// Risk #4 (test-plan.md §2): listDailyExpenditure groups rows by day via a
// `Map` (src/lib/services/activities.ts:62-70) — mirrors meals.ts's grouping
// logic exactly, including the same same-day-accumulation requirement.

describe("GET /api/activities — multiple activities on the same day are summed into one range entry (risk #4)", () => {
  it("sums two activities dated the same day into a single dailyExpenditures entry", async () => {
    server.use(
      postgrestRows("activities", [
        { day: "2026-08-01", calories_kcal: 150 },
        { day: "2026-08-01", calories_kcal: 80 },
      ]),
    );

    const response = await GET(
      buildApiContext({ method: "GET", url: "https://app.test/api/test?from=2026-08-01&to=2026-08-02" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dailyExpenditures).toEqual([{ day: "2026-08-01", calories_kcal: 230 }]);
  });
});
