import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { buildApiContext } from "../helpers/api-context";
import { SUPABASE_ORIGIN, postgrestTripwire } from "../helpers/msw";
import { POST } from "@/pages/api/profile/index";

// Risk #7 (test-plan.md §2): health_goals was the only free-text field
// reaching the FR-012 analysis prompt with no bound at any layer. Mirrors
// wellness.notes's triple (Zod, DB CHECK, textarea maxLength) at 2000 chars.

describe("POST /api/profile — health_goals length bound (risk #7)", () => {
  it("rejects a 2001-character health_goals and writes nothing", async () => {
    server.use(postgrestTripwire());

    const response = await POST(buildApiContext({ formBody: { health_goals: "x".repeat(2001) } }));

    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(decodeURIComponent(location)).toContain("Health goals");
  });

  it("accepts a 2000-character health_goals", async () => {
    server.use(
      http.post(`${SUPABASE_ORIGIN}/rest/v1/health_profiles`, () =>
        HttpResponse.json({
          id: "22222222-2222-4222-8222-222222222222",
          user_id: "11111111-1111-4111-8111-111111111111",
          age: null,
          weight_kg: null,
          height_cm: null,
          activity_level: null,
          health_goals: "x".repeat(2000),
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        }),
      ),
    );

    const response = await POST(buildApiContext({ formBody: { health_goals: "x".repeat(2000) } }));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/profile?saved=1");
  });
});
