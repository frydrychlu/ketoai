import { OPENROUTER_API_KEY } from "astro:env/server";
import type { MacroBreakdown } from "@/types";
import { macroJsonSchema, macroResultSchema } from "./macro-schema";

/**
 * OpenRouter macro-parsing service — the first LLM call from the Cloudflare
 * Worker. Sends a Polish meal description, requests structured JSON output,
 * validates it with Zod, and retries exactly once before giving up.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Model used for macro estimation. Mid-tier, structured-output capable, good at
 * Polish. Keep the exact OpenRouter slug here in one place — confirm against
 * https://openrouter.ai/models if the call fails with a model-not-found error.
 */
const MODEL = "anthropic/claude-haiku-4.5";

/** Thrown when a meal cannot be parsed into valid macros (after one retry). */
export class MacroParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MacroParseError";
  }
}

const SYSTEM_PROMPT = [
  "Jesteś asystentem żywieniowym. Użytkownik opisuje po polsku posiłek, który zjadł.",
  "Oszacuj wartości odżywcze CAŁEGO opisanego posiłku na podstawie typowych wartości produktów.",
  "Zwróć wyłącznie obiekt JSON z kluczami liczbowymi:",
  "fat_g (tłuszcz w gramach), protein_g (białko w gramach),",
  "carbs_g (węglowodany ogółem w gramach), calories_kcal (kalorie w kcal).",
  "Same liczby, bez jednostek w wartościach, bez komentarzy i bez dodatkowego tekstu.",
].join(" ");

/**
 * Parse a free-text Polish meal description into a macro breakdown.
 * @throws {MacroParseError} if the key is missing or parsing fails twice.
 */
export async function parseMealToMacros(description: string): Promise<MacroBreakdown> {
  if (!OPENROUTER_API_KEY) {
    throw new MacroParseError("OPENROUTER_API_KEY is not configured");
  }

  let lastError: unknown;
  // One initial attempt + one retry (decision: retry once, then reject).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await requestMacros(description);
    } catch (error) {
      lastError = error;
    }
  }
  throw new MacroParseError("Could not parse meal into macros", { cause: lastError });
}

async function requestMacros(description: string): Promise<MacroBreakdown> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: macroJsonSchema },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: description },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenRouter response did not include message content");
  }

  // Validate against the Zod schema; throws if the shape is wrong. Returned
  // object already matches MacroBreakdown (same snake_case keys).
  return macroResultSchema.parse(JSON.parse(extractJsonObject(content)));
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
