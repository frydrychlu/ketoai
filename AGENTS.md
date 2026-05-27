# Repository Guidelines

KetoPlanner is a ketogenic diet tracker with macro/biomarker logging, AI analysis, and trend dashboards — built on Astro 6 SSR, React 19, Tailwind 4, Supabase, and Cloudflare Workers. See @KetoAI.md for MVP scope.

## Hard Rules

- API routes must export `const prerender = false` — the app uses full SSR; there are no statically prerendered pages.
- Use `cn()` from `@/lib/utils` for all Tailwind class composition. Never concatenate Tailwind class strings manually.
- No `"use client"` or other Next.js directives in React components — this is not Next.js.
- Supabase migrations: name as `YYYYMMDDHHmmss_short_description.sql` and always enable RLS with granular per-operation, per-role policies.
- `astro/no-set-html-directive` is enforced as an ESLint error — do not use `set:html` in Astro templates.
- Instantiate the Supabase SSR client only via `src/lib/supabase.ts` — do not create ad-hoc Supabase clients in pages or components.

## Project Structure

- `src/components/` — React islands; shadcn/ui primitives in `ui/`; custom hooks in `hooks/`
- `src/lib/` — Supabase SSR client (`supabase.ts`), `cn()` helper (`utils.ts`), business logic in `services/`
- `src/pages/api/` — API routes; uppercase `GET`/`POST` named exports; validate all inputs with Zod
- `src/middleware.ts` — auth guard; attaches `context.locals.user` on every request; extend `PROTECTED_ROUTES` to protect new pages
- `src/types.ts` — all shared entity and DTO types; new shared types go here, not in feature files
- `supabase/migrations/` — SQL migration files

## Commands

- See @package.json scripts

CI (see `@.github/workflows/ci.yml`): `npm ci` → `astro sync` → lint → build on every push/PR to `master`. Requires `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets.

## Conventions

- Path alias: `@/*` → `src/*`; TypeScript strict mode via `@tsconfig.json`
- Prettier: 120-char print width, double quotes, trailing commas — see `@.prettierrc.json`
- shadcn/ui: "new-york" style, neutral base color, lucide icons; components live in `src/components/ui/`; install new ones with `npx shadcn@latest add [name]`
- `no-console` is a lint warning — remove all debug statements before pushing

## Secrets & Configuration

- See @README.md for local setup and required env vars
  
## CI and Deployment

CI: @.github/workflows/ci.yml — runs on every push/PR to master.
Deploy: @README.md (Deployment section). Production secrets via Cloudflare dashboard or `npx wrangler secret put`

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org): `<type>(<scope>): <description>`.

Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `revert`.

Examples:
- `feat(auth): add email confirmation flow`
- `fix(middleware): redirect to signin on expired session`
- `chore: upgrade Astro to 6.3.1`

Breaking changes: append `!` after the type (`feat!: drop legacy API`) or add a `BREAKING CHANGE:` footer.
