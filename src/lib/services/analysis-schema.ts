import { z } from "zod";

/**
 * Single source of truth for the analysis-output shape. Used both to build the
 * OpenRouter `response_format` JSON schema (what we ask the model to return) and
 * as the runtime Zod validator (what we trust before returning to the client).
 * Mirrors the pattern in `macro-schema.ts`.
 *
 * `confidence` and `data_limitations` are required so the model cannot omit the
 * FR-012 hedge — the analysis must always state how sure it is and what the data
 * lacked.
 */
export const analysisResultSchema = z.object({
  summary: z.string().min(1),
  causes: z.array(
    z.object({
      cause: z.string().min(1),
      evidence: z.string().min(1),
    }),
  ),
  confidence: z.enum(["low", "medium", "high"]),
  data_limitations: z.string().min(1),
});

export type AnalysisSchemaResult = z.infer<typeof analysisResultSchema>;

/**
 * JSON schema literal for OpenRouter structured outputs
 * (`response_format: { type: "json_schema", json_schema: analysisJsonSchema }`).
 * `strict` + `additionalProperties: false` + every field required force the
 * model to emit exactly this shape, including the two hedge fields.
 */
export const analysisJsonSchema = {
  name: "ketosis_analysis",
  strict: true,
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "1-2 sentence overview of the ketosis picture over the window",
      },
      causes: {
        type: "array",
        description: "Plausible causes of deviations from ketosis, each grounded in the provided data",
        items: {
          type: "object",
          properties: {
            cause: { type: "string", description: "The plausible cause" },
            evidence: { type: "string", description: "The observation in the data that supports this cause" },
          },
          required: ["cause", "evidence"],
          additionalProperties: false,
        },
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "How confident the analysis is, driven by how much data the window actually held",
      },
      data_limitations: {
        type: "string",
        description: "Explicit statement of what the window lacked (sparse days, missing types) — the required hedge",
      },
    },
    required: ["summary", "causes", "confidence", "data_limitations"],
    additionalProperties: false,
  },
} as const;
