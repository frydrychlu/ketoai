import type { APIContext } from "astro";
import type { User } from "@supabase/supabase-js";

type MinimalUser = Pick<User, "id">;

interface BuildApiContextOptions {
  /** Serialized via JSON.stringify as the request body. Mutually exclusive with `rawBody`/`formBody`. */
  body?: unknown;
  /** Sent verbatim as the request body — use to construct invalid JSON and reach a route's catch branch. */
  rawBody?: string;
  /** Sent as a multipart FormData body (the profile route reads context.request.formData()). */
  formBody?: Record<string, string>;
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
 * context.request, context.cookies, and — for form-based routes —
 * context.redirect. cookies.set is the only cookies method createClient calls
 * (src/lib/supabase.ts:17-21), so a no-op stub suffices — nothing under test
 * reads a cookie back. redirect mirrors Astro's real signature closely enough
 * for assertions: a Response with a Location header and a 302 default status.
 */
export function buildApiContext(options: BuildApiContextOptions = {}): APIContext {
  const {
    body,
    rawBody,
    formBody,
    user = { id: "11111111-1111-4111-8111-111111111111" },
    method = "POST",
    url = "https://app.test/api/test",
  } = options;

  let request: Request;
  if (formBody !== undefined) {
    const data = new FormData();
    for (const [key, value] of Object.entries(formBody)) {
      data.append(key, value);
    }
    // Don't set Content-Type manually — FormData bodies need the boundary
    // Request computes automatically.
    request = new Request(url, { method, body: data });
  } else {
    const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (rawBody !== undefined) {
      init.body = rawBody;
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    request = new Request(url, init);
  }

  const cookies = {
    set: () => undefined,
  } as unknown as APIContext["cookies"];

  const redirect = (path: string, status = 302) => new Response(null, { status, headers: { Location: path } });

  return {
    locals: { user: user as User | null },
    request,
    cookies,
    redirect,
  } as unknown as APIContext;
}
