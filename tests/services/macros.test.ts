import { describe, it, expect } from "vitest";
import { server } from "../setup";
import { openRouterSuccess } from "../helpers/msw";
import { parseMealToMacros, MacroParseError } from "@/lib/services/macros";

// Risk #1 (test-plan.md §2): every user-typed physiological value in this
// codebase is bounded at both ends; AI-derived numerics were bounded only
// below. These tests fail against pre-guard code and pass once
// macro-schema.ts carries the ceiling + Atwater band.

function stubMacroResponse(payload: unknown) {
  server.use(openRouterSuccess(payload));
}

describe("parseMealToMacros — schema guard (risk #1)", () => {
  describe("per-field ceilings", () => {
    // Each ceiling case zeroes the other three fields so derived Atwater
    // calories stay under the 50 kcal floor and the Atwater refine never
    // fires — isolating the ceiling as the sole rejection reason.
    it("rejects fat_g over 1000", async () => {
      stubMacroResponse({ fat_g: 1001, protein_g: 0, carbs_g: 0, calories_kcal: 9009 });
      await expect(parseMealToMacros("test meal")).rejects.toThrow(MacroParseError);
    });

    it("rejects protein_g over 1000", async () => {
      stubMacroResponse({ fat_g: 0, protein_g: 1001, carbs_g: 0, calories_kcal: 4004 });
      await expect(parseMealToMacros("test meal")).rejects.toThrow(MacroParseError);
    });

    it("rejects carbs_g over 1000", async () => {
      stubMacroResponse({ fat_g: 0, protein_g: 0, carbs_g: 1001, calories_kcal: 4004 });
      await expect(parseMealToMacros("test meal")).rejects.toThrow(MacroParseError);
    });

    it("rejects calories_kcal over 10000", async () => {
      stubMacroResponse({ fat_g: 0, protein_g: 0, carbs_g: 0, calories_kcal: 10001 });
      await expect(parseMealToMacros("test meal")).rejects.toThrow(MacroParseError);
    });

    it("accepts a value exactly at the fat_g ceiling", async () => {
      stubMacroResponse({ fat_g: 1000, protein_g: 0, carbs_g: 0, calories_kcal: 9000 });
      await expect(parseMealToMacros("test meal")).resolves.toEqual({
        fat_g: 1000,
        protein_g: 0,
        carbs_g: 0,
        calories_kcal: 9000,
      });
    });

    it("accepts a value exactly at the calories_kcal ceiling", async () => {
      stubMacroResponse({ fat_g: 0, protein_g: 0, carbs_g: 0, calories_kcal: 10000 });
      await expect(parseMealToMacros("test meal")).resolves.toEqual({
        fat_g: 0,
        protein_g: 0,
        carbs_g: 0,
        calories_kcal: 10000,
      });
    });
  });

  describe("Atwater consistency band", () => {
    it("rejects reported calories well below the macro-derived value", async () => {
      // derived = 4*200 = 800; 150 reported is far below the 600 threshold —
      // the hallucination shape: one field inconsistent with the other three.
      stubMacroResponse({ fat_g: 0, protein_g: 0, carbs_g: 200, calories_kcal: 150 });
      await expect(parseMealToMacros("test meal")).rejects.toThrow(MacroParseError);
    });

    it("accepts a high-fibre-shaped meal where computed exceeds reported by ~10%", async () => {
      // derived = 9*10 + 4*20 + 4*30 = 290; 264 reported clears the 217.5 threshold.
      // Fibre yields ~2 kcal/g rather than 4, so computed legitimately runs high.
      stubMacroResponse({ fat_g: 10, protein_g: 20, carbs_g: 30, calories_kcal: 264 });
      await expect(parseMealToMacros("test meal")).resolves.toEqual({
        fat_g: 10,
        protein_g: 20,
        carbs_g: 30,
        calories_kcal: 264,
      });
    });

    it("accepts an alcohol-shaped entry where reported far exceeds computed", async () => {
      // derived = 9*5 + 4*5 + 4*5 = 85; 400 reported represents alcohol
      // calories (~7 kcal/g) that none of the four fields captures.
      stubMacroResponse({ fat_g: 5, protein_g: 5, carbs_g: 5, calories_kcal: 400 });
      await expect(parseMealToMacros("test meal")).resolves.toEqual({
        fat_g: 5,
        protein_g: 5,
        carbs_g: 5,
        calories_kcal: 400,
      });
    });
  });

  describe("existing floor behaviour (regression)", () => {
    it("rejects a negative field", async () => {
      stubMacroResponse({ fat_g: -1, protein_g: 0, carbs_g: 0, calories_kcal: 0 });
      await expect(parseMealToMacros("test meal")).rejects.toThrow(MacroParseError);
    });

    it("rejects a missing field", async () => {
      stubMacroResponse({ fat_g: 0, protein_g: 0, carbs_g: 0 });
      await expect(parseMealToMacros("test meal")).rejects.toThrow(MacroParseError);
    });

    it("rejects a string value", async () => {
      stubMacroResponse({ fat_g: "10", protein_g: 0, carbs_g: 0, calories_kcal: 0 });
      await expect(parseMealToMacros("test meal")).rejects.toThrow(MacroParseError);
    });

    it("rejects a null value", async () => {
      stubMacroResponse({ fat_g: null, protein_g: 0, carbs_g: 0, calories_kcal: 0 });
      await expect(parseMealToMacros("test meal")).rejects.toThrow(MacroParseError);
    });
  });
});
