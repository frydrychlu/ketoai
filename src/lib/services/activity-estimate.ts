import { OPENROUTER_API_KEY } from "astro:env/server";
import { activityEstimateJsonSchema, activityEstimateResultSchema } from "./activity-estimate-schema";

/**
 * OpenRouter activity-estimate service — reuses the LLM boundary proven by the
 * macro parser (`macros.ts`). Sends a Polish activity description, requests a
 * single structured number (estimated calories burned), validates it with Zod,
 * and retries exactly once before giving up.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Model used for the estimate. Mid-tier, structured-output capable, good at
 * Polish. Keep the exact OpenRouter slug here in one place — confirm against
 * https://openrouter.ai/models if the call fails with a model-not-found error.
 */
const MODEL = "anthropic/claude-haiku-4.5";

/** Thrown when an activity cannot be estimated into calories (after one retry). */
export class ActivityEstimateError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ActivityEstimateError";
  }
}

/**
 * An OpenRouter HTTP failure. `retryable` is true only for transient faults
 * (5xx) — 4xx responses (bad key, bad request, rate limit) won't succeed on an
 * immediate retry, so we fail fast instead of burning a second call.
 */
class OpenRouterError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SYSTEM_PROMPT = [
  "Jesteś asystentem fitness. Użytkownik opisuje po polsku aktywność fizyczną, którą wykonał.",
  "Oszacuj CAŁKOWITĄ liczbę spalonych kalorii (kcal) na podstawie typowych wartości dla tej",
  "aktywności oraz czasu trwania podanego w opisie.",
  "Zwróć wyłącznie obiekt JSON z jednym kluczem liczbowym:",
  "calories_kcal (spalone kalorie w kcal).",
  "Sama liczba, bez jednostek w wartości, bez komentarzy i bez dodatkowego tekstu.",
].join(" ");

/**
 * Estimate the caloric expenditure of a free-text Polish activity description.
 * @throws {ActivityEstimateError} if the key is missing or the estimate fails twice.
 */
export async function estimateActivityCalories(description: string): Promise<number> {
  if (!OPENROUTER_API_KEY) {
    throw new ActivityEstimateError("OPENROUTER_API_KEY is not configured");
  }

  let lastError: unknown;
  // One initial attempt + one retry (decision: retry once, then reject).
  // Only transient faults are retried; a non-retryable 4xx fails immediately.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await requestEstimate(description);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof OpenRouterError ? error.retryable : true;
      if (!retryable || attempt === 1) break;
      await delay(300);
    }
  }
  throw new ActivityEstimateError("Could not estimate activity calories", { cause: lastError });
}

async function requestEstimate(description: string): Promise<number> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: activityEstimateJsonSchema },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: description },
      ],
    }),
  });

  if (!response.ok) {
    // Only 5xx is worth retrying; 4xx (bad key/request, rate limit) won't change.
    throw new OpenRouterError(`OpenRouter request failed with status ${response.status}`, response.status >= 500);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenRouter response did not include message content");
  }

  // Validate against the Zod schema; throws if the shape is wrong.
  return activityEstimateResultSchema.parse(JSON.parse(extractJsonObject(content))).calories_kcal;
}

/**
 * Some models wrap JSON in markdown fences or prose. Extract the outermost
 * `{...}` so JSON.parse succeeds regardless. A missing brace falls through to
 * JSON.parse, which throws and is caught by the retry loop.
 */
function extractJsonObject(content: string): string {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return content.slice(start, end + 1);
  }
  return content;
}
