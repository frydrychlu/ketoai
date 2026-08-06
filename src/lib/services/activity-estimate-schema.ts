import { z } from "zod";

/**
 * Single source of truth for the activity-estimate shape. Used both to build the
 * OpenRouter `response_format` JSON schema (what we ask the model to return) and
 * as the runtime Zod validator (what we trust before persisting).
 *
 * One numeric key — the estimated caloric expenditure — mirroring the
 * `public.activities.calories_kcal` column so the validated result maps straight
 * through with no translation layer.
 */
// Ceiling only — unlike the meal path, a single number has no correlate to
// check for internal consistency, so no Atwater-style cross-field guard is
// possible here.
export const activityEstimateResultSchema = z.object({
  calories_kcal: z.number().min(0).max(10000),
});

export type ActivityEstimateResult = z.infer<typeof activityEstimateResultSchema>;

/**
 * JSON schema literal for OpenRouter structured outputs
 * (`response_format: { type: "json_schema", json_schema: activityEstimateJsonSchema }`).
 * `strict` + `additionalProperties: false` + the field required force the model
 * to emit exactly one numeric key.
 */
export const activityEstimateJsonSchema = {
  name: "activity_estimate",
  strict: true,
  schema: {
    type: "object",
    properties: {
      calories_kcal: { type: "number", description: "Total energy expended in kilocalories" },
    },
    required: ["calories_kcal"],
    additionalProperties: false,
  },
} as const;
