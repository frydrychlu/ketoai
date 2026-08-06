import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";

type MinimalUser = Pick<User, "id">;

interface BuildApiContextOptions {
  /** Serialized via JSON.stringify as the request body. Mutually exclusive with `rawBody`. */
  body?: unknown;
  /** Sent verbatim as the request body — use to construct invalid JSON and reach a route's catch branch. */
  rawBody?: string;
  user?: MinimalUser | null;
  method?: string;
  url?: string;
}

/**
 * Builds a minimal APIContext for invoking an exported POST/GET handler
 * directly. Astro ships no official route-testing helper, and the Container
 * API's endpoint support is experimental — importing the handler and calling
 * it with a hand-built context is the pragmatic alternative.
 *
 * The routes under test read only context.locals.user (truthiness and .id),
 * context.request, and context.cookies. cookies.set is the only cookies
 * method createClient calls (src/lib/supabase.ts:17-21), so a no-op stub
 * suffices — nothing under test reads a cookie back.
 */
export function buildApiContext(options: BuildApiContextOptions = {}): APIContext {
  const {
    body,
    rawBody,
    user = { id: "11111111-1111-4111-8111-111111111111" },
    method = "POST",
    url = "https://app.test/api/test",
  } = options;

  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (rawBody !== undefined) {
    init.body = rawBody;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const request = new Request(url, init);

  const cookies = {
    set: () => undefined,
  } as unknown as APIContext["cookies"];

  return {
    locals: { user: user as User | null },
    request,
    cookies,
  } as unknown as APIContext;
}
