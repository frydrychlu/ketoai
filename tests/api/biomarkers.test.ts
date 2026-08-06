import { describe, it, expect } from "vitest";
import { server } from "../setup";
import { buildApiContext } from "../helpers/api-context";
import { postgrestTripwire } from "../helpers/msw";
import { POST } from "@/pages/api/biomarkers/index";

// Risk #4 (test-plan.md §2): computeGki has no internal div-by-zero guard —
// the guard lives entirely upstream, in the route's Zod schema. The "defined,
// correct result" for a zero (or sub-floor) ketones value is rejection before
// persistence, never a GKI of Infinity reaching the database.

describe("POST /api/biomarkers — ketones boundary rejects before persistence (risk #4)", () => {
  it("rejects ketones_mmol_l: 0 with 400 and writes nothing", async () => {
    server.use(postgrestTripwire());

    const response = await POST(
      buildApiContext({ body: { day: "2026-08-01", ketones_mmol_l: 0, glucose_mg_dl: 90 } }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects ketones_mmol_l: 0.05 (passes the DB CHECK > 0 but fails the Zod min(0.1) floor) with 400 and writes nothing", async () => {
    server.use(postgrestTripwire());

    const response = await POST(
      buildApiContext({ body: { day: "2026-08-01", ketones_mmol_l: 0.05, glucose_mg_dl: 90 } }),
    );

    expect(response.status).toBe(400);
  });
});
