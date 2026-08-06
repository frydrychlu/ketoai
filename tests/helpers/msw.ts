import { http, HttpResponse } from "msw";

// Matches SUPABASE_URL in tests/stubs/astro-env.ts. @supabase/ssr's
// createServerClient injects no custom fetch (src/lib/supabase.ts:9-23), so
// PostgREST traffic arrives on global fetch just like the OpenRouter call —
// one MSW server sees both, distinguished by origin.
export const SUPABASE_ORIGIN = "https://stub.supabase.test";
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** An OpenRouter chat-completion success carrying `content` as the model's JSON payload. */
export function openRouterSuccess(content: unknown) {
  return http.post(OPENROUTER_URL, () =>
    HttpResponse.json({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  );
}

/** An OpenRouter HTTP failure (e.g. 429, 500) with no body. */
export function openRouterFailure(status: number) {
  return http.post(OPENROUTER_URL, () => new HttpResponse(null, { status }));
}

/** A 200 OpenRouter response whose message content is not valid JSON. */
export function openRouterMalformed() {
  return http.post(OPENROUTER_URL, () => HttpResponse.json({ choices: [{ message: { content: "not json" } }] }));
}

/**
 * Fails the test the moment an OpenRouter call is made, naming the call in
 * the failure rather than requiring a lifecycle-event count. Install when a
 * test asserts "no model call was made".
 */
export function openRouterTripwire() {
  return http.post(OPENROUTER_URL, () => {
    throw new Error("Tripwire: an OpenRouter request was made but the test expected none");
  });
}

/** A PostgREST GET on `table` returning `rows` (range reads / listReadings-style calls). */
export function postgrestRows(table: string, rows: unknown[]) {
  return http.get(`${SUPABASE_ORIGIN}/rest/v1/${table}`, () => HttpResponse.json(rows));
}

/**
 * Fails the test the moment any request reaches PostgREST — any table, any
 * method. Install when a test asserts "no database read or write happened".
 */
export function postgrestTripwire() {
  return http.all(`${SUPABASE_ORIGIN}/rest/v1/*`, () => {
    throw new Error("Tripwire: a PostgREST request was made but the test expected none");
  });
}
