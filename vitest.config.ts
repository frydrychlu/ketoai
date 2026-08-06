// Hand-written config — deliberately NOT built on Astro's getViteConfig().
// getViteConfig() runs runHookConfigSetup, which activates the Cloudflare
// adapter and injects @cloudflare/vite-plugin. That plugin is incompatible
// with Vitest 4 on the versions this repo has installed (astro 6.3.1,
// @astrojs/cloudflare 13.5.0 — both predate the withastro/astro#15878 fix).
// Sidestepping getViteConfig avoids the incompatibility entirely, at the cost
// of no .astro compilation and no astro:* virtual modules — the only one used
// under test is astro:env/server, aliased below to a stub.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "astro:env/server": path.resolve(import.meta.dirname, "./tests/stubs/astro-env.ts"),
    },
  },
});
