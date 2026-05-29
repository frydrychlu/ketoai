---
project: KetoAI
researched_at: 2026-05-28
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (via @astrojs/cloudflare v13.5.0)
  database: Supabase (external, PostgreSQL + Auth)
  ai_provider: OpenRouter (external)
---

## Recommendation

**Deploy on Cloudflare Workers.**

The project's tech stack is already wired for Cloudflare: `@astrojs/cloudflare` v13.5.0 is installed, `wrangler.jsonc` is present with the correct `nodejs_compat` flag and `compatibility_date`, and `astro.config.mjs` uses `output: "server"` with `adapter: cloudflare()`. Deploying to any other platform would require swapping the adapter and reconfiguring the project from scratch. The Workers free tier handles 100k requests/month at $0, the CLI (`wrangler`) covers every routine operation including rollback, and the platform has a GA MCP server and `llms.txt`-backed docs — making it the highest-scoring option on every agent-friendly criterion. The user's existing Cloudflare familiarity removes the platform learning curve entirely.

## Platform Comparison

### Scoring Matrix (Pass = 2 / Partial = 1 / Fail = 0)

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | **Total** |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **10** |
| **Netlify** | Partial | Pass | Pass | Pass | Pass | **9** |
| **Vercel** | Partial | Pass | Pass | Pass | Partial | **8** |
| **Render** | Partial | Partial | Pass | Pass | Partial | **7** |
| **Railway** | Partial | Partial | Partial | Pass | Partial | **6** |
| **Fly.io** | Partial | Partial | Partial | Pass | Fail | **5** |

**Scoring rationale per criterion:**

**CLI-first**: Cloudflare earns the only Pass because `wrangler rollback <VERSION_ID>` is a real, documented CLI command — no dashboard visit required for any routine operation. Every other platform has at least one operation (rollback for Netlify/Railway/Render, or a workaround-based image redeploy for Fly.io) that is dashboard-only or requires scripting the API directly.

**Managed/Serverless**: Cloudflare Workers, Vercel, and Netlify all earn Pass — they run zero-configuration serverless runtimes with no infrastructure to provision or size. Render, Railway, and Fly.io deploy persistent processes (Node.js VMs or containers) that require specifying instance sizes, handling cold-start vs. always-on trade-offs, and managing more moving parts.

**Agent-readable docs**: Cloudflare, Vercel, Netlify, and Render all publish `llms.txt` and serve docs as markdown. Fly.io and Railway serve docs as HTML-rendered pages (no `llms.txt`); Railway has a `.md` URL suffix workaround that partially compensates.

**Stable deploy API**: All six platforms pass — each has a scriptable CLI that produces predictable output and is designed for CI use.

**MCP / Integration**: Cloudflare and Netlify earn Pass — `@cloudflare/mcp-server-cloudflare` is GA with broad tool coverage; `@netlify/mcp` is published with write capabilities. Vercel, Railway, and Render earn Partial (Vercel's MCP is beta and read-only; Railway's is WIP; Render's GA MCP excludes destructive operations). Fly.io earns Fail — their MCP server has 4 commits total, and Fly's own blog recommends against using MCP for agent integration.

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

The native target for the current stack. `@astrojs/cloudflare` v13.5.0 and `wrangler.jsonc` are already in place — no adapter swap, no config rewrite. Free tier covers 100k requests/month at $0. The GA `@cloudflare/mcp-server-cloudflare` provides structured access to deployments, logs, and KV/D1 resources. `developers.cloudflare.com/llms.txt` is machine-readable. `wrangler rollback` is a first-class CLI operation. The `nodejs_compat` compatibility flag required for Supabase SSR is already set in `wrangler.jsonc`.

#### 2. Netlify

Strong second choice. Astro 6 SSR support was confirmed GA on 2026-03-10 with `@astrojs/netlify`. The `@netlify/mcp` server is published with write access (env vars, deploy triggers, project creation). `llms.txt` and `.md` URL suffix for any page make docs fully agent-readable. The free credit tier handles the anticipated traffic. The gap vs. Cloudflare: requires swapping to the `@astrojs/netlify` adapter, rollback is not available as a CLI command (UI-only or API scripting), and cold starts of 800ms–1.5s affect SSR page load times.

#### 3. Vercel

Solid third choice. `llms.txt` and `llms-full.txt` are published; automatic per-PR preview URLs are GA. The main gaps: an open esbuild/dynamic-import bug under Astro 6 (GitHub #16258, not yet patched as of May 2026), commercial use requires the Pro plan at $20/user/month, and the official MCP server is beta and read-only only.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **CPU time limit on the free tier is a silent trap.** The Workers free plan caps at 10 ms CPU time per invocation (not wall-clock time). An SSR page with Supabase JWT verification + React rendering + a database query can hit this. `astro dev` runs on workerd locally but without a CPU cap — so the limit never triggers in development, only in production. Upgrading to Workers Paid ($5/month) removes it entirely.
2. **`nodejs_compat` is required but not self-advertising.** `@supabase/ssr` depends on Node.js internals. Without the `compatibility_flags = ["nodejs_compat"]` entry in `wrangler.jsonc`, the build succeeds and the runtime throws cryptic errors on first Supabase call. *Mitigated in this project: the flag is already set.*
3. **Cloudflare Pages vs Workers confusion.** The `@astrojs/cloudflare` adapter targets Workers (`wrangler deploy`), not Cloudflare Pages git integration. Automatic branch preview URLs belong to the Pages product — they don't apply here. Workers SSR preview environments require a separate `--env` configuration in `wrangler.jsonc`. Following Pages tutorials while deploying to Workers sets wrong expectations about preview URL behavior.
4. **Wrangler v4 breaks v3 tutorials.** The project pins `wrangler ^4.90.0`. The v3 command `wrangler pages deploy` is deprecated in v4 in favor of `wrangler deploy`. Most community tutorials and StackOverflow answers still reference v3 syntax. Copy-pasting from them produces commands that fail or deploy to the wrong target.
5. **Worker bundle size limit is 10 MB compressed** (100 MB on paid). An Astro 6 + React 19 app with shadcn/ui, chart libraries (for trend dashboards), and the Supabase SDK can approach 10 MB on the free tier. Hitting this limit late in the build forces a refactor or an unplanned plan upgrade.

### Pre-Mortem — How This Could Fail

Three weeks into a 6-week MVP build, pages begin randomly failing in production with `Error 1101: Worker exceeded CPU time limit`. The developer tested exclusively with `astro dev` on workerd, which has no CPU cap — the free tier's 10 ms limit never appeared locally. Upgrading to Workers Paid ($5/month) fixes it, but the CI pipeline is still running a `wrangler pages deploy` command copied from a Cloudflare Pages tutorial — deploying to the wrong product entirely. The wrangler v4 deprecation warning was present in the CI log for weeks but scrolled past unnoticed. In week 4, Supabase sessions stop persisting across navigations. The `nodejs_compat` flag was accidentally removed during a `wrangler.jsonc` cleanup — the build succeeded, runtime failed silently with in-memory session fallback. Each navigation creates a new JWT, working until it expires mid-session. The AI analysis feature's OpenRouter streaming response isn't rendering — the Workers fetch API handles `ReadableStream` differently from Node.js `stream`, and the component assumes the Node.js streaming model. By week 5 all three issues are resolved, but the debugging time consumed the build window for the correlation chart feature — the primary product differentiator ships late or not at all. Every failure mode was documented in GitHub issues; none appeared on the platform landing page.

### Unknown Unknowns

- **`astro dev` workerd parity is better in Astro 6 but still has edge cases.** Local secrets live in `.dev.vars` (not `.env`). Some `process.env` vs `import.meta.env` resolution differences persist. Testing only locally and assuming production parity will surface surprises.
- **Wrangler secrets and `vars` are two separate systems with different security properties.** `npx wrangler secret put` stores encrypted values accessible only at runtime (invisible in logs and dashboard). `wrangler.jsonc` `vars` are plaintext and visible in the Cloudflare dashboard. Using `vars` for `SUPABASE_KEY` or `OPENROUTER_API_KEY` exposes them in deployment metadata.
- **`wrangler.jsonc` is JSONC (JSON with comments) — most tutorials show `wrangler.toml`.** Copy-pasting TOML config into a JSONC file produces a syntactically valid JSON file that silently ignores the pasted fields.
- **`nodejs_compat` polyfills do not cover all Node.js APIs.** `node:worker_threads`, `node:child_process`, and parts of `node:crypto` are not polyfilled. Any indirect dependency using these APIs fails at runtime with an error that looks unrelated to the missing polyfill.
- **OpenRouter streaming responses require explicit `ReadableStream` handling.** The Workers `fetch()` wraps responses differently from Node.js `http`. Streaming AI responses from OpenRouter require `ReadableStream` iteration, not the Node.js stream pipeline API.

## Operational Story

- **Preview deploys**: This project deploys via `wrangler deploy` (Workers), not Cloudflare Pages git integration. Automatic branch preview URLs (as with Pages) do not apply. For PR previews, add a `[env.staging]` block to `wrangler.jsonc` with a distinct worker name (e.g., `ketoai-staging`) and deploy with `npx wrangler deploy --env staging` in a GitHub Actions preview step. The staging worker gets its own `*.workers.dev` subdomain.
- **Secrets**: `npx wrangler secret put SUPABASE_URL`, `npx wrangler secret put SUPABASE_KEY`, `npx wrangler secret put OPENROUTER_API_KEY` — encrypted, runtime-only, never visible in `wrangler.jsonc` or deployment logs. Rotate by re-running the same command with the new value; the new secret takes effect on the next request with no redeployment needed.
- **Rollback**: `npx wrangler rollback` reverts to the immediately prior deployment. `npx wrangler versions list` shows all versions with IDs; `npx wrangler rollback <VERSION_ID>` rolls back to any specific version. Typical time-to-revert: ~30 seconds. Supabase database migrations do not roll back automatically — coordinate schema rollbacks manually.
- **Approval**: Agent may run `npx wrangler deploy`, `npx wrangler tail`, `npx wrangler deployments list`, `npx wrangler versions list`, `npx wrangler rollback`. Human-only: `wrangler delete` (removes the worker), secret rotation for production keys, domain/route changes, and any Supabase schema migration.
- **Logs**: `npx wrangler tail` streams real-time Worker logs. `npx wrangler tail --status error` filters to errors only. Observability is already enabled in `wrangler.jsonc` (`"observability": { "enabled": true }`). Via MCP: `@cloudflare/mcp-server-cloudflare` exposes `workers_deployments_list` and log query tools for structured read-only access.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| CPU time limit (10 ms/req on free tier) causes `Error 1101` in production | Devil's advocate | Medium | High | Upgrade to Workers Paid ($5/month) at first sign of CPU errors; monitor with `wrangler tail --status error` |
| `nodejs_compat` flag removed by accident during config edits | Devil's advocate | Low | High | Already set in `wrangler.jsonc`; add a comment in the file noting its necessity for Supabase SSR; include in pre-deploy checklist |
| Pages vs Workers tutorial confusion leads to wrong deploy target | Devil's advocate | Medium | Medium | AGENTS.md specifies `wrangler deploy` — not `wrangler pages deploy`; README deployment section is the authoritative reference |
| Wrangler v4 tutorials from community use deprecated v3 syntax | Devil's advocate | High | Low | Use only `wrangler` CLI help or Cloudflare official docs; any `wrangler pages deploy` command in CI/scripts is wrong |
| Worker bundle size approaches 10 MB free tier limit | Devil's advocate | Medium | Medium | Run `npx wrangler deploy --dry-run` to check bundle size before shipping chart library integrations; upgrade to paid if needed |
| CPU cap + Supabase queries + React SSR renders too slowly | Pre-mortem | Medium | High | Profile `astro build` output size early; consider `astro:env` lazy loading and code-splitting heavy chart components |
| Session persistence breaks silently on nodejs_compat removal | Pre-mortem | Low | High | Mitigated: flag is already present; pin it in `wrangler.jsonc` review checklist |
| OpenRouter streaming responses incompatible with Workers fetch API | Pre-mortem | Medium | Medium | Test streaming at the Worker boundary early (Week 1 spike); use `ReadableStream` not Node.js `stream.pipe()` patterns |
| `.dev.vars` vs `.env` local secrets confusion | Unknown unknowns | High | Low | Document in README: local secrets go in `.dev.vars`, not `.env`; `.dev.vars` is already referenced in README setup |
| `wrangler.jsonc` `vars` used for secrets instead of `wrangler secret put` | Unknown unknowns | Medium | High | Never put SUPABASE_KEY or OPENROUTER_API_KEY in `vars` block; use `wrangler secret put` only |
| Transitive dependency uses unpolyfilled Node.js API | Unknown unknowns | Low | Medium | Run `npx wrangler deploy --dry-run` and inspect for bundle errors; check indirect Supabase/OpenRouter dependencies on `node:worker_threads` or `node:child_process` |

## Getting Started

The project is already configured for Cloudflare Workers. These are the steps to complete a first production deploy:

1. **Authenticate with Cloudflare**: `npx wrangler login` — opens browser OAuth flow; writes token to `~/.wrangler/config/default.toml`.

2. **Rename the worker** in `wrangler.jsonc`: change `"name": "10x-astro-starter"` to `"name": "ketoai"` (or your preferred production name) before first deploy to avoid conflicts.

3. **Set production secrets** (never use `vars` for these):
   ```
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   npx wrangler secret put OPENROUTER_API_KEY
   ```

4. **Build and deploy**:
   ```
   npm run build
   npx wrangler deploy
   ```
   The worker is live at `https://ketoai.<your-subdomain>.workers.dev` immediately after deploy.

5. **Verify with log tail**:
   ```
   npx wrangler tail --status error
   ```
   If you see `Error 1101` (CPU limit), upgrade to Workers Paid: Cloudflare dashboard → Workers & Pages → your worker → Settings → Usage Model → Paid.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (ci.yml already exists at `.github/workflows/ci.yml`)
- Production-scale architecture (multi-region, HA, DR)
- Cloudflare D1 or KV for caching (Supabase handles all persistence)
