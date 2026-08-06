import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";
import { SUPABASE_URL, OPENROUTER_API_KEY, setOpenRouterApiKey, resetAstroEnv } from "./stubs/astro-env";
import { server } from "./setup";
import { OPENROUTER_URL, openRouterTripwire } from "./helpers/msw";

describe("harness smoke test", () => {
  it("resolves the @ alias into src/", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("stubs astro:env/server with a non-empty default", () => {
    expect(SUPABASE_URL).toBe("https://stub.supabase.test");
    expect(OPENROUTER_API_KEY).toBe("stub-openrouter-key");
  });

  it("reflects a setter through the live binding", () => {
    setOpenRouterApiKey(undefined);
    expect(OPENROUTER_API_KEY).toBeUndefined();
    resetAstroEnv();
    expect(OPENROUTER_API_KEY).toBe("stub-openrouter-key");
  });

  it("routes fetch through MSW, and a thrown tripwire names itself in the response", async () => {
    // MSW converts a resolver's thrown error into a 500 response carrying
    // {name, message, stack} as JSON — it does not reject fetch(). A firing
    // tripwire therefore surfaces to the caller as a self-describing failure
    // response, not a generic network error.
    server.use(openRouterTripwire());
    const response = await fetch(OPENROUTER_URL, { method: "POST", body: "{}" });
    expect(response.status).toBe(500);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toMatch(/Tripwire/);
  });
});
