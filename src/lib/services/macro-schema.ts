import { z } from "zod";

/**
 * Single source of truth for the parsed-macro shape. Used both to build the
 * OpenRouter `response_format` JSON schema (what we ask the model to return) and
 * as the runtime Zod validator (what we trust before persisting).
 *
 * Field names mirror `MacroBreakdown` / the `public.meals` columns so the
 * validated result maps straight through with no translation layer.
 */
export const macroResultSchema = z
  .object({
    fat_g: z.number().min(0).max(1000),
    protein_g: z.number().min(0).max(1000),
    carbs_g: z.number().min(0).max(1000),
    calories_kcal: z.number().min(0).max(10000),
  })
  .refine(
    ({ fat_g, protein_g, carbs_g, calories_kcal }) => {
      // Atwater: 9 kcal/g fat, 4 kcal/g protein and carbs. Reject only when reported
      // calories fall well BELOW the macro-derived value — that is the hallucination
      // shape (one inconsistent field among four, e.g. carbs: 200 with calories: 150).
      // Tolerate reported ABOVE computed without limit: alcohol is ~7 kcal/g and is
      // represented by none of the four fields, so a drink legitimately reads high.
      // Fibre pushes computed ~7-10% above reported (fibre yields ~2 kcal/g, not 4),
      // which sits well inside the 25% slack.
      // 0.75 and the 50 kcal floor are judgment calls, not sourced values — no PRD
      // line fixes them. The floor keeps rounding noise on tiny entries from tripping
      // the rule.
      const derived = 9 * fat_g + 4 * protein_g + 4 * carbs_g;
      return derived < 50 || calories_kcal >= derived * 0.75;
    },
    { message: "Reported calories are inconsistent with the macro breakdown" },
  );

export type MacroResult = z.infer<typeof macroResultSchema>;

/**
 * JSON schema literal for OpenRouter structured outputs
 * (`response_format: { type: "json_schema", json_schema: macroJsonSchema }`).
 * `strict` + `additionalProperties: false` + all fields required force the model
 * to emit exactly these four numeric keys.
 */
export const macroJsonSchema = {
  name: "macro_breakdown",
  strict: true,
  schema: {
    type: "object",
    properties: {
      fat_g: { type: "number", description: "Total fat in grams" },
      protein_g: { type: "number", description: "Total protein in grams" },
      carbs_g: { type: "number", description: "Total carbohydrates in grams" },
      calories_kcal: { type: "number", description: "Total energy in kilocalories" },
    },
    required: ["fat_g", "protein_g", "carbs_g", "calories_kcal"],
    additionalProperties: false,
  },
} as const;
