import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { buildApiContext } from "../helpers/api-context";
import { OPENROUTER_URL, postgrestRows, postgrestTripwire } from "../helpers/msw";
import { GET, POST } from "@/pages/api/meals/index";

// Risk #1 (test-plan.md §2): the property risk #1 is actually about — a
// guard-violating model response must never reach persistence. The PostgREST
// tripwire proves the insert never fires; if it did, the route would surface
// 500 ("Could not save meal"), not 422, making a firing tripwire visible as
// an assertion failure on the status code alone.

describe("POST /api/meals — guard rejection reaches neither the user's data nor a wasted retry (risk #1)", () => {
  it("surfaces a guard-violating response as 422, costs exactly two OpenRouter calls, and writes nothing", async () => {
    let calls = 0;
    server.use(
      http.post(OPENROUTER_URL, () => {
        calls++;
        // Atwater-inconsistent: derived = 4*200 = 800, reported 150 is far below the 600 threshold.
        return HttpResponse.json({
          choices: [
            { message: { content: JSON.stringify({ fat_g: 0, protein_g: 0, carbs_g: 200, calories_kcal: 150 }) } },
          ],
        });
      }),
      postgrestTripwire(),
    );

    const response = await POST(buildApiContext({ body: { description: "test meal", day: "2026-08-01" } }));

    expect(response.status).toBe(422);
    expect(calls).toBe(2);
  });
});

// Risk #4 (test-plan.md §2): listDailyTotals (reached via the range branch
// below) omits a day with no meals from its result array rather than
// zero-filling it — the opposite of sumDailyTotal's empty-day behavior
// pinned directly in tests/services/meals.test.ts. Both halves of this
// documented asymmetry (src/types.ts:40) are now regression-locked.

describe("GET /api/meals — empty-day omission, not zero-fill, in range results (risk #4)", () => {
  it("omits a day with no meals from the range result instead of returning a zero-filled entry", async () => {
    server.use(
      postgrestRows("meals", [{ day: "2026-08-01", fat_g: 10, protein_g: 20, carbs_g: 5, calories_kcal: 210 }]),
    );

    const response = await GET(
      buildApiContext({ method: "GET", url: "https://app.test/api/test?from=2026-08-01&to=2026-08-02" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dailyTotals).toEqual([
      { day: "2026-08-01", fat_g: 10, protein_g: 20, carbs_g: 5, calories_kcal: 210 },
    ]);
  });
});
