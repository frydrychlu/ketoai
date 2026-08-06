import { afterAll, afterEach, beforeAll } from "vitest";
import { setupServer } from "msw/node";
import { resetAstroEnv } from "./stubs/astro-env";

// onUnhandledRequest: "error" means any outbound fetch a test didn't stub
// fails the test loudly, rather than hitting the real network or silently
// resolving undefined.
export const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
  resetAstroEnv();
});

afterAll(() => {
  server.close();
});
