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

## Data Isolation & Migration Pattern

Every user-owned table follows the pattern proven by `supabase/migrations/20260609151323_isolation_canary.sql` (the `isolation_canary` reference table). Copy it:

- Column convention: `id uuid primary key default gen_random_uuid()`, `user_id uuid not null references auth.users (id) on delete cascade`.
- `alter table ... enable row level security;`
- Four granular policies, each `to authenticated` and keyed on `auth.uid() = user_id`: SELECT (`using`), INSERT (`with check`), UPDATE (`using` + `with check`), DELETE (`using`). Isolation is enforced purely by RLS — the SSR client (`src/lib/supabase.ts`) runs every query as the logged-in user.

Migration workflow (local-first: develop against local Supabase via Docker, push to cloud on merge to `master`):

- Author the `.sql` file in `supabase/migrations/` (filename rule above).
- Local dev: `npx supabase start` (needs Docker Desktop running) brings up the local stack and auto-applies all migrations. Iterate with `npx supabase db reset` to wipe and replay migrations from scratch. `.env`/`.dev.vars` point at local (`http://127.0.0.1:54321`); Studio is at `http://127.0.0.1:54323`. Stop with `npx supabase stop`.
- Push to cloud (after merge): one-time `npx supabase login` + `npx supabase link --project-ref <ref>` (needs the DB password), then `npx supabase db push`. `db push` reaches the cloud via the linked project, not via `.env`, so local creds in `.env` never interfere. Migrations are forward-only; rollback is a new `drop`/`alter` migration.

Verify isolation with `supabase/tests/isolation_canary_rls.sql` — a re-runnable SQL recipe that impersonates two users via `set local role authenticated` + `set local request.jwt.claims` and asserts one user cannot see another's rows. Run it locally against the db container (`docker exec -i supabase_db_<project_id> psql -U postgres -d postgres < <file>`) after creating two `auth.users`, or in the cloud SQL Editor. Copy it (swap table + UUIDs) to verify each new table.

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
