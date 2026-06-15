import { z } from "zod";

/**
 * Single source of truth for the parsed-macro shape. Used both to build the
 * OpenRouter `response_format` JSON schema (what we ask the model to return) and
 * as the runtime Zod validator (what we trust before persisting).
 *
 * Field names mirror `MacroBreakdown` / the `public.meals` columns so the
 * validated result maps straight through with no translation layer.
 */
export const macroResultSchema = z.object({
  fat_g: z.number().min(0),
  protein_g: z.number().min(0),
  carbs_g: z.number().min(0),
  calories_kcal: z.number().min(0),
});

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
