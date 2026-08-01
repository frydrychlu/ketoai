import { OPENROUTER_API_KEY } from "astro:env/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalysisCoverage, AnalysisResult, AnalysisWindow } from "@/types";
import { listDailyTotals } from "./meals";
import { listDailyExpenditure } from "./activities";
import { listReadings } from "./biomarkers";
import { listEntries } from "./wellness";
import { getProfile } from "./profile";
import { analysisJsonSchema, analysisResultSchema } from "./analysis-schema";

/**
 * On-demand AI analysis service (S-09). This module assembles the N-day data
 * window the analysis reasons over (`gatherAnalysisWindow`) and turns it into a
 * validated structured result via OpenRouter (`requestAnalysis`), reusing the
 * LLM boundary proven by the macro parser (`macros.ts`).
 */

/** Whole calendar days between two inclusive ISO `YYYY-MM-DD` dates, plus one. */
function inclusiveDaySpan(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Gather the current user's data for the inclusive `[from, to]` window and
 * compute per-type day coverage. Every read is RLS-scoped to the logged-in user
 * (the SSR client runs as that user), so the assembled window can only ever
 * contain the requesting user's own data — the FR-012 isolation guardrail is
 * enforced structurally, not by a filter here. Reads run in parallel.
 *
 * Meals and activities arrive pre-aggregated to daily totals (one point per day
 * with data); biomarkers and wellness are one row per day. Coverage counts are
 * therefore the array lengths. `hasAnyData` is false only when no data type has
 * a single day — a profile alone does not count as analyzable data.
 *
 * `from`/`to` are ISO `YYYY-MM-DD`; the caller guarantees `from <= to`.
 */
export async function gatherAnalysisWindow(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<AnalysisWindow> {
  const [profile, meals, activities, biomarkers, wellness] = await Promise.all([
    getProfile(supabase),
    listDailyTotals(supabase, from, to),
    listDailyExpenditure(supabase, from, to),
    listReadings(supabase, from, to),
    listEntries(supabase, from, to),
  ]);

  const coverage: AnalysisCoverage = {
    totalDays: inclusiveDaySpan(from, to),
    mealDays: meals.length,
    activityDays: activities.length,
    biomarkerDays: biomarkers.length,
    wellnessDays: wellness.length,
    hasProfile: profile !== null,
    hasAnyData: meals.length > 0 || activities.length > 0 || biomarkers.length > 0 || wellness.length > 0,
  };

  return { profile, meals, activities, biomarkers, wellness, coverage };
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Model used for the analysis. Mid-tier, structured-output capable, good at
 * Polish — same slug as the macro/activity services. Keep it here in one place;
 * confirm against https://openrouter.ai/models if the call fails with a
 * model-not-found error.
 */
const MODEL = "anthropic/claude-haiku-4.5";

/** Thrown when an analysis cannot be produced (missing key, or parse fails twice). */
export class AnalysisError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AnalysisError";
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
  "Jesteś asystentem specjalizującym się w diecie ketogenicznej. Analizujesz dane użytkownika z ostatnich kilku dni:",
  "posiłki (makroskładniki), aktywność fizyczną (spalone kalorie), biomarkery (ketony mmol/L, glukoza mg/dL, indeks GKI)",
  "oraz parametry samopoczucia. GKI = (glukoza / 18) / ketony; niższy GKI oznacza głębszą ketozę.",
  "Twoim zadaniem jest wskazać PRAWDOPODOBNE przyczyny odchyleń od ketozy (np. za dużo węglowodanów, za mało aktywności).",
  "Każdą przyczynę powiąż z konkretną obserwacją w danych (pole evidence).",
  "KLUCZOWE: oceniaj pewność (confidence) NA PODSTAWIE tego, ile dni faktycznie zawiera dane — te fakty podane są w sekcji",
  "COVERAGE. Gdy dane są rzadkie lub niepełne, ustaw niższą pewność i JAWNIE opisz ograniczenia w polu data_limitations",
  "(np. „analiza oparta na 3 z 14 dni — wzorce mogą być niewiarygodne”). Nie zmyślaj danych, których nie ma.",
  "Odpowiadaj po polsku, wyłącznie w formacie JSON zgodnym ze schematem.",
].join(" ");

/**
 * Serialize the gathered window into a compact prompt payload: the profile
 * baseline, the per-day series for each type, and the server-computed COVERAGE
 * facts that drive the hedge. Meals/activities are already daily totals and
 * biomarkers/wellness one row per day, so this stays small (≤ ~120 records).
 */
function buildUserMessage(window: AnalysisWindow): string {
  const { profile, meals, activities, biomarkers, wellness, coverage } = window;
  return JSON.stringify({
    COVERAGE: coverage,
    profile,
    meals,
    activities,
    biomarkers,
    wellness,
  });
}

/**
 * Turn a gathered window into a validated structured analysis. Reuses the
 * macro-parser boundary: one initial attempt + one retry, retrying only
 * transient 5xx faults. The caller is expected to have already short-circuited
 * the fully-empty window (see the route's empty-gate); this always calls the LLM.
 * @throws {AnalysisError} if the key is missing or parsing fails twice.
 */
export async function requestAnalysis(window: AnalysisWindow): Promise<AnalysisResult> {
  if (!OPENROUTER_API_KEY) {
    throw new AnalysisError("OPENROUTER_API_KEY is not configured");
  }

  const userMessage = buildUserMessage(window);

  let lastError: unknown;
  // One initial attempt + one retry (decision: retry once, then reject).
  // Only transient faults are retried; a non-retryable 4xx fails immediately.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await requestOnce(userMessage);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof OpenRouterError ? error.retryable : true;
      if (!retryable || attempt === 1) break;
      await delay(300);
    }
  }
  throw new AnalysisError("Could not produce analysis", { cause: lastError });
}

async function requestOnce(userMessage: string): Promise<AnalysisResult> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: analysisJsonSchema },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
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

  // Validate against the Zod schema; throws if the shape is wrong. The returned
  // object already matches AnalysisResult (same keys).
  return analysisResultSchema.parse(JSON.parse(extractJsonObject(content)));
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
