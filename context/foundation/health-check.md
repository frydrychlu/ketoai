---
project: KetoPlanner (10x-astro-starter)
checked_at: 2026-05-27T12:00:00Z
health_status: critical-issues
context_type: brownfield
language_family: js
stack_assessment_available: false
checks_run:
  - lockfile
  - dependency_audit
  - outdated_deps
  - test_runner
  - ci_cd
  - configuration
audit_findings:
  critical: 0
  high: 1
  moderate: 9
  low: 0
test_runner_detected: false
ci_provider: GitHub Actions
recommended_fixes: 5
---

## Dependency Health

### Lockfile

```
Status: present (package-lock.json)
Package manager: npm
```

### Security Audit

```
Tool: npm audit --json
Summary: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
Direct vs transitive: distinguished — 2 direct packages affected (wrangler, @astrojs/check);
                       remaining findings are transitive
```

#### HIGH findings

- **devalue** 5.6.3–5.8.0 — GHSA-77vg-94rm-hx3p: DoS via sparse array deserialization (CVSS 7.5). Transitive dependency via the Astro framework. Fix: `npm audit fix` (fix available).

#### MODERATE findings (9)

- **ws** — Uninitialized memory disclosure (CVSS 4.4). Transitive via `wrangler` and `@supabase/realtime-js`. Fix available.
- **yaml** — Stack Overflow via deeply nested YAML collections (CVSS 4.3). Transitive via `yaml-language-server` → `volar-service-yaml` → `@astrojs/language-server` → `@astrojs/check`. Fix requires downgrading `@astrojs/check` to 0.9.2 (major version change).
- **wrangler** (direct) — MODERATE via `miniflare` → `ws`. Fix: `npm update wrangler`.
- **@astrojs/check** (direct) — MODERATE via `@astrojs/language-server` → `volar-service-yaml` → `yaml`. Fix: downgrade to 0.9.2 (`npm install @astrojs/check@0.9.2`).
- **miniflare**, **@cloudflare/vite-plugin**, **volar-service-yaml**, **@astrojs/language-server**, **yaml-language-server** — all transitive, fix available via `npm audit fix`.

### Outdated Dependencies

```
Packages with major version gaps: 0 (no package is 2+ major versions behind)
```

Notable single-major-version gaps in direct dependencies (worth monitoring):

- **eslint**: 9.x → 10.4.0 (1 major version behind)
- **typescript**: 5.9.3 → 6.0.3 (1 major version behind)
- **lint-staged**: 16.x → 17.0.5 (1 major version behind)

Several minor/patch updates are also available (`astro`, `tailwindcss`, `supabase`, `wrangler`). These are routine and not blocking.

---

## Test Suite

```
Test runner: not detected
Tests found: none
Test execution: not attempted
```

No test script exists in `package.json`. No `vitest.config.*`, `jest.config.*`, `playwright.config.*`, or `cypress.config.*` found in the project root.

```
⚠ No test runner detected. The agent cannot verify its own changes.
Recommended: Install Vitest — the natural choice for an Astro/Vite project.

  npm install -D vitest @vitest/ui
  # Add to package.json scripts:
  "test": "vitest run",
  "test:watch": "vitest"
```

---

## CI/CD

```
Provider: GitHub Actions
Configuration: .github/workflows/ci.yml
```

| Stage      | Status | Notes                                                             |
|------------|--------|-------------------------------------------------------------------|
| Lint       | ✓      | `npm run lint` (ESLint with typescript-eslint)                    |
| Test       | ✗      | No test step — no test runner configured yet                      |
| Build      | ✓      | `npm run build` (Astro SSR build for Cloudflare Workers)          |
| Type check | ✗      | No `astro check` or `tsc --noEmit` step                          |
| Security   | ✗      | No `npm audit` step                                               |

The existing CI covers the two most important developer-feedback loops (lint + build), which is a solid foundation. Adding test, type-check, and security stages will make it complete.

---

## Configuration

### High severity

No high-severity configuration gaps. TypeScript strict mode is active via `extends: "astro/tsconfigs/strict"`, and both ESLint (`eslint.config.js`) and Prettier (`.prettierrc.json`) are configured.

### Low severity

- **.editorconfig** — Ensures consistent indentation and line endings across editors and OS environments. Without it, contributors on different editors may introduce invisible whitespace diffs. Fix: create a `.editorconfig` file at the project root (5 minutes, copy a standard Astro project template).

---

## Stack Assessment Cross-Reference

```
No stack-assessment.md found. Run /10x-stack-assess for quality-gate analysis.
```

---

## Recommended Fixes

### Fix before agent work (Category A)

### 1. Set up a test runner

**Impact**: Without a test runner, the agent has no automated way to verify its own changes. Every code change carries higher risk because correctness must be manually confirmed. This is the single most impactful gap for agent collaboration.
**Severity**: high
**Effort**: moderate (15–30 min)
**Fix**:

```bash
npm install -D vitest @vitest/ui
```

Then add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

Create `vitest.config.ts` at the project root:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

Add an initial smoke test (e.g., `src/lib/utils.test.ts`) to confirm the setup works, then add the test step to CI.

---

### 2. Fix HIGH security advisory (devalue)

**Impact**: The `devalue` DoS vulnerability (CVSS 7.5) affects deserialization in the Astro framework. While the attack surface is server-side and requires crafted input, it's worth patching before extended agent work — agents may add endpoints that process untrusted data.
**Severity**: high
**Effort**: quick (< 5 min)
**Fix**:

```bash
npm audit fix
```

If `npm audit fix` cannot resolve all findings automatically (some require the `--force` flag or manual pinning), check what remains:

```bash
npm audit
```

For the `@astrojs/check` chain (MODERATE, requires major downgrade), you may choose to accept the risk since it's a dev-only dependency used for language-server support in editors.

---

### 3. Add `astro check` to CI for type coverage

**Impact**: The CI pipeline lints with typescript-eslint but does not run `astro check`, which validates types across `.astro` component files. Undetected type errors in Astro files can slip through — especially relevant when the agent generates or edits component files.
**Severity**: medium
**Effort**: quick (< 5 min)
**Fix**:

Add to `.github/workflows/ci.yml` after the `npx astro sync` step:

```yaml
- run: npx astro check
```

Also add a `check` script to `package.json` for local use:

```json
"check": "astro check"
```

---

### 4. Add `npm audit` to CI

**Impact**: Security regressions from new dependencies go undetected without an audit step in CI. The agent may introduce new packages during development.
**Severity**: medium
**Effort**: quick (< 5 min)
**Fix**:

Add to `.github/workflows/ci.yml` (after `npm ci`):

```yaml
- run: npm audit --audit-level=high
```

Using `--audit-level=high` fails the build only on HIGH/CRITICAL findings, treating MODERATE advisories as informational.

---

### 5. Add `.editorconfig`

**Impact**: Low — mostly cosmetic. Prevents whitespace drift when contributors use different editors or OS line endings.
**Severity**: low
**Effort**: quick (< 5 min)
**Fix**:

Create `.editorconfig` at the project root:

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

---

### Addressed in upcoming lessons (Category B)

### Missing test step in CI

**Lesson**: [Sprint Zero z Agentem: infrastruktura, walking skeleton i pierwszy deploy (M1L5)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l5)
**What you'll do there**: Set up CI/CD properly, add the test stage to the pipeline, and configure deployment to Cloudflare Workers. Once you add a test runner (Category A fix above), the CI step is a one-liner — this lesson will bring it all together.

### Agent instruction files (AGENTS.md)

**Lesson**: [Agent Onboarding: Agents.md, AI Rules i feedback loops (M1L4)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l4)
**What you'll do there**: You already have `CLAUDE.md` in place — that's a strong start. The agent onboarding lesson walks you through enriching it with project-specific rules, feedback loops, and instruction patterns that help the agent collaborate more effectively on this codebase.

---

## Summary

```
Health status: critical-issues
```

KetoPlanner has a well-structured Astro SSR stack with solid TypeScript configuration (strict mode enabled), working ESLint + Prettier tooling, a GitHub Actions CI pipeline, and a pinned lockfile — all strong foundations for agent collaboration. The critical gap is the absence of a test runner: without one, the agent cannot verify its own changes, making every code edit a manual review burden. There is also one HIGH security advisory (`devalue` DoS) that is straightforward to resolve with `npm audit fix`. Once a test runner is in place and the security advisory is patched, this project will be in good shape for agent-assisted development.

Next step: install Vitest (fix #1 above — about 20 minutes), then run `npm audit fix` (fix #2 — under 5 minutes). Those two changes flip the verdict from `critical-issues` to `healthy` and unlock confident agent collaboration.
