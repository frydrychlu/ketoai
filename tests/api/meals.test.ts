import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { buildApiContext } from "../helpers/api-context";
import {
  OPENROUTER_URL,
  SUPABASE_ORIGIN,
  openRouterSuccess,
  openRouterTripwire,
  postgrestRows,
  postgrestTripwire,
} from "../helpers/msw";
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

// Risk #4 (test-plan.md §2): daySchema's round-trip refine — not just its
// regex — decides which day an entry counts toward. 2026 is not a leap year
// (2026 mod 4 = 2); the leap-day pair below uses 2024 (leap) and 2023 (not),
// per research.md, to avoid silently testing the wrong thing.

describe("GET/POST /api/meals — day validity boundary (risk #4)", () => {
  it("GET rejects a structurally-valid but nonexistent date (2026-02-30) with 400", async () => {
    const response = await GET(buildApiContext({ method: "GET", url: "https://app.test/api/test?day=2026-02-30" }));

    expect(response.status).toBe(400);
  });

  it("GET rejects a regex-invalid date (2026-13-45) with 400", async () => {
    const response = await GET(buildApiContext({ method: "GET", url: "https://app.test/api/test?day=2026-13-45" }));

    expect(response.status).toBe(400);
  });

  it("POST rejects a structurally-valid but nonexistent date (2026-02-30) with 400, no model call, no write", async () => {
    server.use(openRouterTripwire(), postgrestTripwire());

    const response = await POST(buildApiContext({ body: { description: "test meal", day: "2026-02-30" } }));

    expect(response.status).toBe(400);
  });

  it("POST rejects Feb 29 in a non-leap year (2023-02-29) with 400, no model call, no write", async () => {
    server.use(openRouterTripwire(), postgrestTripwire());

    const response = await POST(buildApiContext({ body: { description: "test meal", day: "2023-02-29" } }));

    expect(response.status).toBe(400);
  });

  it("POST accepts a real leap day (2024-02-29) and proceeds to the model call", async () => {
    server.use(
      openRouterSuccess({ fat_g: 10, protein_g: 20, carbs_g: 5, calories_kcal: 190 }),
      http.post(`${SUPABASE_ORIGIN}/rest/v1/meals`, () =>
        HttpResponse.json({
          id: "33333333-3333-4333-8333-333333333333",
          user_id: "11111111-1111-4111-8111-111111111111",
          description: "test meal",
          fat_g: 10,
          protein_g: 20,
          carbs_g: 5,
          calories_kcal: 190,
          day: "2024-02-29",
          logged_at: "2024-02-29T12:00:00.000Z",
        }),
      ),
      postgrestRows("meals", [
        { id: "33333333-3333-4333-8333-333333333333", fat_g: 10, protein_g: 20, carbs_g: 5, calories_kcal: 190 },
      ]),
    );

    const response = await POST(buildApiContext({ body: { description: "test meal", day: "2024-02-29" } }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.total).toEqual({ fat_g: 10, protein_g: 20, carbs_g: 5, calories_kcal: 190 });
  });
});

// Risk #4 (test-plan.md §2): listDailyTotals groups rows by day via a `Map`
// (src/lib/services/meals.ts:68-76) — a second meal on a day already seen
// must accumulate into that day's existing entry, not overwrite it. Only a
// two-rows-same-day range fixture can distinguish "grouped and summed" from
// "one row per day silently wins."

describe("GET /api/meals — multiple meals on the same day are summed into one range entry (risk #4)", () => {
  it("sums two meals dated the same day into a single dailyTotals entry", async () => {
    server.use(
      postgrestRows("meals", [
        { day: "2026-08-01", fat_g: 10, protein_g: 20, carbs_g: 5, calories_kcal: 210 },
        { day: "2026-08-01", fat_g: 4, protein_g: 6, carbs_g: 1, calories_kcal: 82 },
      ]),
    );

    const response = await GET(
      buildApiContext({ method: "GET", url: "https://app.test/api/test?from=2026-08-01&to=2026-08-02" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dailyTotals).toEqual([
      { day: "2026-08-01", fat_g: 14, protein_g: 26, carbs_g: 6, calories_kcal: 292 },
    ]);
  });
});
