import { describe, it, expect } from "vitest";
import { server } from "../setup";
import { openRouterSuccess } from "../helpers/msw";
import { estimateActivityCalories, ActivityEstimateError } from "@/lib/services/activity-estimate";

// Same ceiling coverage as macros.test.ts, applied to the activity twin. One
// number, no correlate — so no Atwater-style consistency check is possible
// here, only the ceiling.

function stubActivityResponse(payload: unknown) {
  server.use(openRouterSuccess(payload));
}

describe("estimateActivityCalories — schema guard (risk #1)", () => {
  it("rejects calories_kcal over 10000", async () => {
    stubActivityResponse({ calories_kcal: 10001 });
    await expect(estimateActivityCalories("test activity")).rejects.toThrow(ActivityEstimateError);
  });

  it("accepts calories_kcal exactly at 10000", async () => {
    stubActivityResponse({ calories_kcal: 10000 });
    await expect(estimateActivityCalories("test activity")).resolves.toBe(10000);
  });

  it("rejects a negative value (existing floor, regression)", async () => {
    stubActivityResponse({ calories_kcal: -1 });
    await expect(estimateActivityCalories("test activity")).rejects.toThrow(ActivityEstimateError);
  });

  it("rejects a missing field (existing floor, regression)", async () => {
    stubActivityResponse({});
    await expect(estimateActivityCalories("test activity")).rejects.toThrow(ActivityEstimateError);
  });
});
