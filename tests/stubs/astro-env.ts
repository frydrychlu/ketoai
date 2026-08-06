// Stand-in for astro:env/server, aliased in vitest.config.ts. All three vars
// are declared `optional: true` in astro.config.mjs, so `string | undefined`
// matches the real module's shape.
//
// Exported as mutable `let` bindings rather than a getter object: every
// service reads these inside its function body (not at module load), so an
// ESM live binding lets a test flip a value with a setter and have the next
// call see it immediately — no vi.resetModules() needed.
export let SUPABASE_URL: string | undefined = "https://stub.supabase.test";
export let SUPABASE_KEY: string | undefined = "stub-anon-key";
export let OPENROUTER_API_KEY: string | undefined = "stub-openrouter-key";

const DEFAULTS = {
  SUPABASE_URL: "https://stub.supabase.test",
  SUPABASE_KEY: "stub-anon-key",
  OPENROUTER_API_KEY: "stub-openrouter-key",
} as const;

export function setSupabaseUrl(value: string | undefined): void {
  SUPABASE_URL = value;
}

export function setSupabaseKey(value: string | undefined): void {
  SUPABASE_KEY = value;
}

export function setOpenRouterApiKey(value: string | undefined): void {
  OPENROUTER_API_KEY = value;
}

/** Restore all three vars to their non-empty defaults. Call in afterEach. */
export function resetAstroEnv(): void {
  SUPABASE_URL = DEFAULTS.SUPABASE_URL;
  SUPABASE_KEY = DEFAULTS.SUPABASE_KEY;
  OPENROUTER_API_KEY = DEFAULTS.OPENROUTER_API_KEY;
}
