import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { buildApiContext } from "../helpers/api-context";
import { SUPABASE_ORIGIN, OPENROUTER_URL, openRouterTripwire, postgrestRows, postgrestTripwire } from "../helpers/msw";
import { POST } from "@/pages/api/analysis/index";

// Risk #7 (test-plan.md §2): a hostile or out-of-range window_days must be
// rejected at the request boundary before any DB read or model call. Research
// (2026-08-06) found the parameter half already closed — window_days is a
// three-literal union, not a range — so these tests are a regression lock on
// that bound, not a red-to-green fix. All should pass against unchanged code.

const TO = "2026-08-01";
const ONE_MEAL_ROW = [{ day: "2026-07-20", fat_g: 10, protein_g: 10, carbs_g: 10, calories_kcal: 170 }];
const VALID_ANALYSIS_RESULT = {
  summary: "Test summary.",
  causes: [{ cause: "Zbyt duża ilość węglowodanów", evidence: "Test evidence." }],
  confidence: "low",
  data_limitations: "Test limitations.",
};

/** All five reads empty — triggers the empty-window gate, no model call. */
function emptyWindowHandlers() {
  return [
    postgrestRows("meals", []),
    postgrestRows("activities", []),
    postgrestRows("biomarker_readings", []),
    postgrestRows("wellness_entries", []),
    postgrestRows("health_profiles", []),
  ];
}

/** One meal present, everything else empty — triggers hasAnyData, reaches the model call. */
function nonEmptyWindowHandlers() {
  return [
    postgrestRows("meals", ONE_MEAL_ROW),
    postgrestRows("activities", []),
    postgrestRows("biomarker_readings", []),
    postgrestRows("wellness_entries", []),
    postgrestRows("health_profiles", []),
  ];
}

describe("POST /api/analysis — request boundary (risk #7)", () => {
  describe("7.1 window_days is a closed set, not a range", () => {
    it.each([7, 14, 30])("accepts window_days=%s", async (n) => {
      server.use(...emptyWindowHandlers(), openRouterTripwire());
      const response = await POST(buildApiContext({ body: { window_days: n, to: TO } }));
      expect(response.status).toBe(200);
    });

    // Deliberately hard-coded 7/14/30 rather than importing ANALYSIS_WINDOWS.
    // Importing the constant the route validates against would make this a
    // mirror test — widening ANALYSIS_WINDOWS would silently widen this test
    // too, and failing on exactly that widening is this lock's entire purpose.
    it.each([0, -1, 6, 31, 365, 1e9, 3.5, "14", null, []])("rejects window_days=%j", async (value) => {
      const response = await POST(buildApiContext({ body: { window_days: value, to: TO } }));
      expect(response.status).toBe(400);
    });

    it("rejects a request with window_days absent entirely", async () => {
      const response = await POST(buildApiContext({ body: { to: TO } }));
      expect(response.status).toBe(400);
    });
  });

  describe("7.2 rejection precedes every cost, not just the model call", () => {
    it("produces zero outbound requests — no OpenRouter call and no PostgREST read", async () => {
      // If either tripwire fires, the route surfaces something other than a
      // clean 400 (the PostgREST tripwire throws inside gatherAnalysisWindow,
      // which the route's catch turns into 500) — so this assertion alone
      // proves neither call happened.
      server.use(openRouterTripwire(), postgrestTripwire());
      const response = await POST(buildApiContext({ body: { window_days: 0, to: TO } }));
      expect(response.status).toBe(400);
    });
  });

  describe("7.3 two distinct 400s", () => {
    it("malformed JSON returns 400 with the JSON-parse message", async () => {
      const response = await POST(buildApiContext({ rawBody: "{not valid json" }));
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { error: string };
      expect(payload.error).toBe("Invalid JSON body");
    });

    it("a bad window_days returns 400 with a Zod field issue, distinct from the JSON error", async () => {
      const response = await POST(buildApiContext({ body: { window_days: 0, to: TO } }));
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { error: string; issues: Record<string, string[]> };
      expect(payload.error).toBe("Validation failed");
      expect(payload.issues.window_days).toBeDefined();
    });
  });

  describe("7.4 an accepted request's shape", () => {
    it("sends exactly one OpenRouter request whose window is from = to - (N-1)", async () => {
      let openRouterCalls = 0;
      let capturedMealsUrl: URL | undefined;

      server.use(
        http.get(`${SUPABASE_ORIGIN}/rest/v1/meals`, ({ request }) => {
          capturedMealsUrl = new URL(request.url);
          return HttpResponse.json(ONE_MEAL_ROW);
        }),
        postgrestRows("activities", []),
        postgrestRows("biomarker_readings", []),
        postgrestRows("wellness_entries", []),
        postgrestRows("health_profiles", []),
        http.post(OPENROUTER_URL, () => {
          openRouterCalls++;
          return HttpResponse.json({ choices: [{ message: { content: JSON.stringify(VALID_ANALYSIS_RESULT) } }] });
        }),
      );

      const response = await POST(buildApiContext({ body: { window_days: 14, to: TO } }));

      expect(response.status).toBe(200);
      expect(openRouterCalls).toBe(1);
      // A 14-day window ending 2026-08-01 starts 13 days earlier: 2026-07-19.
      expect(capturedMealsUrl?.searchParams.getAll("day")).toEqual(
        expect.arrayContaining(["gte.2026-07-19", "lte.2026-08-01"]),
      );
    });
  });

  describe("7.5 the empty-window gate", () => {
    it("returns status: empty at HTTP 200 with no model call", async () => {
      server.use(...emptyWindowHandlers(), openRouterTripwire());
      const response = await POST(buildApiContext({ body: { window_days: 14, to: TO } }));
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { status: string };
      expect(payload.status).toBe("empty");
    });
  });

  describe("7.6 retry cost is a pinned cost-control property", () => {
    // Exception to the count-mirroring rule research warns against elsewhere:
    // here the call count IS the property under test — a permanent failure
    // must not silently double-spend on a pointless retry.
    it("a non-retryable 4xx costs exactly one OpenRouter call", async () => {
      let calls = 0;
      server.use(
        ...nonEmptyWindowHandlers(),
        http.post(OPENROUTER_URL, () => {
          calls++;
          return new HttpResponse(null, { status: 400 });
        }),
      );
      const response = await POST(buildApiContext({ body: { window_days: 14, to: TO } }));
      expect(response.status).toBe(422);
      expect(calls).toBe(1);
    });

    it("a retryable 5xx costs at most two OpenRouter calls", async () => {
      let calls = 0;
      server.use(
        ...nonEmptyWindowHandlers(),
        http.post(OPENROUTER_URL, () => {
          calls++;
          return new HttpResponse(null, { status: 503 });
        }),
      );
      const response = await POST(buildApiContext({ body: { window_days: 14, to: TO } }));
      expect(response.status).toBe(422);
      expect(calls).toBe(2);
    });
  });

  describe("7.7 extra body keys never reach the prompt", () => {
    it("strips unknown keys before the outbound OpenRouter request", async () => {
      let capturedContent = "";
      server.use(
        ...nonEmptyWindowHandlers(),
        http.post(OPENROUTER_URL, async ({ request }) => {
          const body = (await request.json()) as { messages: { role: string; content: string }[] };
          capturedContent = body.messages[1].content;
          return HttpResponse.json({ choices: [{ message: { content: JSON.stringify(VALID_ANALYSIS_RESULT) } }] });
        }),
      );

      const response = await POST(buildApiContext({ body: { window_days: 14, to: TO, injected: "x".repeat(5000) } }));

      expect(response.status).toBe(200);
      expect(capturedContent).not.toContain("injected");
    });
  });
});
