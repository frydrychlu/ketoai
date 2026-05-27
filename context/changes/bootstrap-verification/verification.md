---
bootstrapped_at: 2026-05-27T18:35:00Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: ketoai
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: ketoai
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

KetoAI is a solo, 6-week, after-hours web app targeting small user scale with a privacy-first constraint: each user sees only their own health data. The 10x Astro Starter ships exactly the primitives this project needs — Supabase provides PostgreSQL with Row-Level Security for strict per-user data isolation, built-in email/password auth for FR-001/002, and a typed TypeScript SDK; Astro 6 + React 19 handles the interactive dashboard, trend charts, and daily logging forms; Cloudflare Pages delivers a zero-config global deployment on the free tier. The AI feature set (macro parsing and on-demand correlation analysis via the Anthropic API) layers on top as Astro API routes with no additional infrastructure. TypeScript throughout and Zod at the API boundaries give agents explicit schemas to reason from, reducing drift in an after-hours solo build where review bandwidth is tight.

## Pre-scaffold verification

| Signal      | Value                                              | Severity | Notes                                        |
| ----------- | -------------------------------------------------- | -------- | -------------------------------------------- |
| npm package | not run                                            | n/a      | cmd_template starts with `git clone`; npm check skipped |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh | 10 days before scaffold run; from card docs_url |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: cloned starter repo without keeping its git history
**Exit code**: 0
**Files moved**: 41 source files (excluding node_modules); 773 npm packages installed into node_modules
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold`
**.gitignore handling**: moved silently (absent in cwd before scaffold)
**.bootstrap-scaffold cleanup**: directory locked post-move (Windows Defender/indexer holding handle); manual cleanup required: `Remove-Item -Recurse -Force .bootstrap-scaffold`

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: all vulnerabilities are in transitive packages; 2 direct packages (`@astrojs/check`, `wrangler`) have vulnerable transitive dependencies

#### HIGH findings

**devalue** (range 5.6.3 – 5.8.0)
- Advisory: GHSA-77vg-94rm-hx3p
- Title: Svelte devalue — DoS via sparse array deserialization
- CWE: CWE-770 (Allocation of Resources Without Limits)
- CVSS: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
- Transitive dependency (not a direct dep)
- Fix available: run `npm audit fix`

#### MODERATE findings (9)

All are transitive dependencies and all have fixes available via `npm audit fix` or `npm audit fix --force`:

1. **@astrojs/check** — via `@astrojs/language-server` (direct package, vulnerable transitive). Fix: downgrade to `@astrojs/check@0.9.2` (semver-major).
2. **@astrojs/language-server** — via `volar-service-yaml`. Transitive.
3. **@cloudflare/vite-plugin** — via `miniflare`, `wrangler`, `ws`. Transitive.
4. **miniflare** — via `ws` (uninitialized memory disclosure). Transitive.
5. **volar-service-yaml** — via `yaml-language-server`. Transitive.
6. **wrangler** — via `miniflare` (direct package, vulnerable transitive). Fix: `npm audit fix`.
7. **ws** — uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx, CWE-908, CVSS 4.4, range 8.0.0–8.20.0). Transitive.
8. **yaml** — stack overflow via deeply nested YAML collections (GHSA-48c2-rrv3-qjmp, CWE-674, CVSS 4.3). Transitive (in yaml-language-server).
9. **yaml-language-server** — via `yaml`. Transitive.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | true                 |
| has_background_jobs     | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` (the starter's CLAUDE.md) and decide whether to merge it into your existing `CLAUDE.md`.
- Run `Remove-Item -Recurse -Force .bootstrap-scaffold` once Windows releases the directory lock to complete cleanup.
- Address audit findings per your project's risk tolerance — the 1 HIGH finding (`devalue`) and most MODERATE findings are fixable with `npm audit fix`. The `@astrojs/check` and `yaml`-chain fixes require `npm audit fix --force` (breaking changes).
- Copy `.env.example` to `.env` and fill in your Supabase and Cloudflare credentials before running `npm run dev`.
