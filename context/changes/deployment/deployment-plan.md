# KetoPlanner — Cloudflare Workers First Deploy Plan

## Context

KetoPlanner is wired for Cloudflare Workers (`@astrojs/cloudflare` adapter, `output: "server"`, `nodejs_compat` flag, `wrangler.jsonc` present), but has never been deployed. The worker name has been renamed to `ketoai`. No `.dev.vars` file exists for local secrets, three API routes are missing a required `export const prerender = false`, and no Cloudflare secrets have been set. The goal is a clean first production deploy to `ketoai.<subdomain>.workers.dev`, with Cloudflare Workers Builds wired to auto-deploy on every push to `master`.

**Critical files:**
- `wrangler.jsonc` — worker name rename, verified flags
- `astro.config.mjs` — env schema (add `OPENROUTER_API_KEY`)
- `src/pages/api/auth/signin.ts`, `signout.ts`, `signup.ts` — add `prerender = false`
- `.dev.vars` — create from `.env.example`

---

## Phase 0 — Prerequisites

> Gates: Node.js 22 installed, a Cloudflare account exists, a cloud Supabase project exists, and `npx wrangler --version` prints a version number.

### ✅ 0.1 — Verify Node.js version

The project requires Node.js **v22**. Check what you have:

```
node --version
```

Expected output: `v22.x.x`. If you see an older version or `node` is not found, download the LTS installer from [nodejs.org](https://nodejs.org) and install it. After installation, reopen your terminal and re-run the check.

### ✅ 0.2 — Install project dependencies (if not done yet)

```
npm install
```

This installs all packages listed in `package.json`, including `wrangler` (the Cloudflare CLI). Wrangler is used as a local dev dependency — you run it via `npx wrangler` rather than installing it globally.

Verify Wrangler is available:

```
npx wrangler --version
```

Expected output: `⛅️ wrangler x.y.z ...`.

### ✅ 0.3 — Create a Cloudflare account

Wrangler needs a Cloudflare account to deploy.

1. Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
2. Register with your email address — a free plan is sufficient for the entire MVP.
3. Verify your email when the confirmation arrives.

You do **not** need to add a domain or a credit card at this stage.

### ✅ 0.4 — Create a cloud Supabase project

The app uses Supabase for authentication. You need a hosted project (the free tier covers the MVP comfortably).

1. Go to [supabase.com](https://supabase.com) and sign up / sign in.
2. Click **New project** in the dashboard.
3. Fill in:
   | Field | Value |
   |---|---|
   | Organisation | your personal org (created automatically) |
   | Project name | `ketoai` (or any name you like) |
   | Database password | choose a strong password and **save it somewhere** — you will not see it again |
   | Region | pick the closest region to your users |
4. Click **Create new project**. Supabase takes ~1 minute to spin up.

### ✅ 0.5 — Retrieve Supabase credentials

Once the project is ready:

1. Open the project in the Supabase dashboard.
2. Go to **Settings → API** (left sidebar).
3. Copy two values — you will need them in Phase 1 and Phase 4:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **anon public** key — a long JWT string under "Project API keys"

   > The `anon` key is safe to use in your app. It grants public access subject to your Row Level Security policies. The `service_role` key is **not** needed and should never be used client-side.

### 0.6 — Disable email confirmation during development

By default Supabase requires users to click a confirmation link before they can sign in. During initial testing this adds friction. Disable it now:

1. Supabase dashboard → **Authentication** → **Email**.
2. Toggle **Confirm email** to **off**.
3. Click **Save**.

You can re-enable it before going live if you want email verification in production.

---

## Phase 1 — Local Environment Setup

> Gates: `.dev.vars` populated, `npm run dev` resolves without errors.

- [ ] **1.1** Copy env template to `.dev.vars`:
  ```
  cp .env.example .dev.vars
  ```
- [ ] **1.2** Have your Supabase credentials ready — you copied them in **Phase 0.5** (Project URL and anon key). If you skipped Phase 0, go back and do it now.
- [ ] **1.3** Populate `.dev.vars`:
  ```
  SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_KEY=<anon-key>
  ```
- [ ] **1.4** Verify local dev works:
  ```
  npm run dev
  ```
  Navigate to `/auth/signup` → sign up → confirm redirect to `/auth/confirm-email`. Then sign in and confirm `/dashboard` loads.

  > Email confirmation should already be disabled from Phase 0.6. If sign-in fails with "Email not confirmed", go back and toggle it off.

---

## Phase 2 — Code Fixes (Required Before Deploy)

> Gates: `npm run lint` passes, `npm run build` succeeds.

- [x] **2.1 Rename worker** in `wrangler.jsonc` line 3:
  ```jsonc
  "name": "ketoai",
  ```
  Do this **before** first deploy — the name becomes the permanent `*.workers.dev` subdomain.

- [ ] **2.2 Add `prerender = false` to all three API routes** (AGENTS.md hard rule):
  - `src/pages/api/auth/signin.ts` — add `export const prerender = false;` as first export
  - `src/pages/api/auth/signout.ts` — same
  - `src/pages/api/auth/signup.ts` — same

- [ ] **2.3 Add `OPENROUTER_API_KEY` to `astro.config.mjs` env schema** (AI features in MVP scope, secret not wired yet):
  ```js
  OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
  ```
  Add after the existing `SUPABASE_KEY` entry.

- [ ] **2.4 Verify build is clean:**
  ```
  npm run lint
  npm run build
  ```

---

## Phase 3 — Cloudflare Account & CLI Auth

> Gate: `npx wrangler whoami` shows the correct Cloudflare account.

- [ ] **3.1** Authenticate:
  ```
  npx wrangler login
  ```
  Opens browser OAuth flow. Token is written to `~/.wrangler/config/default.toml`.
- [ ] **3.2** Confirm account:
  ```
  npx wrangler whoami
  ```

---

## Phase 4 — Production Secrets

> Gate: `npx wrangler secret list` shows all three keys.

Set secrets via CLI — **never** put these in `wrangler.jsonc` `vars` (they'd be visible in dashboard metadata).

- [ ] **4.1** `npx wrangler secret put SUPABASE_URL` → paste cloud project URL
- [ ] **4.2** `npx wrangler secret put SUPABASE_KEY` → paste anon key
- [ ] **4.3** `npx wrangler secret put OPENROUTER_API_KEY` → placeholder value acceptable now (e.g. `PLACEHOLDER`); rotate when AI features land
- [ ] **4.4** Verify:
  ```
  npx wrangler secret list
  ```
  Expected output: three entries (`SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY`).

---

## Phase 5 — Build, Dry-Run & Deploy

> Gate: Worker live at `https://ketoai.<subdomain>.workers.dev`.

- [ ] **5.1** Build:
  ```
  npm run build
  ```
- [ ] **5.2** Check bundle size (free tier limit: 10 MB compressed):
  ```
  npx wrangler deploy --dry-run --outdir dist-check
  ```
  Review the output for total compressed size. If it approaches 8 MB, flag for paid tier upgrade before adding chart libraries.

  **Edge case — bundle too large:** The current stack (Astro 6 + React 19 + shadcn + Supabase SDK) should be under 5 MB, but verify. If over 10 MB, split heavy components with `import()`.

- [ ] **5.3** Deploy:
  ```
  npx wrangler deploy
  ```
  Wrangler prints the live URL: `https://ketoai.<subdomain>.workers.dev`.

- [ ] **5.4** Note the deployment version ID from output (for rollback reference).

---

## Phase 6 — Verification

> Gate: Auth flow passes end-to-end on production URL; no `Error 1101` in tail.

- [ ] **6.1** Start log tail in a separate terminal:
  ```
  npx wrangler tail --status error
  ```
  Keep this running during all verification steps below.

- [ ] **6.2** Open `https://ketoai.<subdomain>.workers.dev` — landing page loads.
- [ ] **6.3** Sign up with a test email → redirected to `/auth/confirm-email`.
- [ ] **6.4** Sign in → redirected to `/dashboard` — user email visible.
- [ ] **6.5** Sign out → redirected to home.
- [ ] **6.6** Visit `/dashboard` without auth → redirected to `/auth/signin`. ✓

  **Edge case — `Error 1101` (CPU time limit):**
  If you see this in `wrangler tail` during any of the above steps, upgrade immediately:
  Cloudflare dashboard → Workers & Pages → `ketoai` → Settings → Usage Model → **Paid** ($5/month).
  The free tier's 10 ms CPU cap is invisible in `astro dev` but real in production.

  **Edge case — session not persisting across navigation:**
  Supabase SSR session lives in cookies. If clicking links causes re-login, check that the cloud project's Site URL is set to the production workers.dev URL: Supabase dashboard → Authentication → URL Configuration → Site URL.

  **Edge case — `nodejs_compat` stripped accidentally:**
  If you see `ReferenceError: Buffer is not defined` or similar crypto errors, verify `wrangler.jsonc` still contains `"compatibility_flags": ["nodejs_compat"]`.

---

## Phase 7 — Cloudflare Workers Builds (Auto-Deploy)

> Gate: Push to `master` → Cloudflare builds and deploys automatically without GitHub Actions.

This is configured in the Cloudflare dashboard (human-only step — agent cannot click UI).

- [ ] **7.1** Open Cloudflare dashboard → **Workers & Pages** → `ketoai` → **Settings** → **Build**.
- [ ] **7.2** Click **Connect to Git** → authorize GitHub → select the `KetoPlanner` repository.
- [ ] **7.3** Configure build settings:
  | Field | Value |
  |---|---|
  | Production branch | `master` |
  | Build command | `npm run build` |
  | Deploy command | *(leave empty — wrangler handles it)* |
  | Root directory | *(leave empty)* |
  | Node.js version | `22` |
- [ ] **7.4** Add **build-time environment variables** (these are for the build step, distinct from runtime secrets set in Phase 4):
  | Variable | Value |
  |---|---|
  | `SUPABASE_URL` | your cloud project URL |
  | `SUPABASE_KEY` | your anon key |

  **Why:** `npm run build` runs `astro build` which evaluates the `astro:env` schema. Without `SUPABASE_URL` and `SUPABASE_KEY` at build time the build fails (matches what ci.yml already does via GitHub secrets).

- [ ] **7.5** Save and trigger a test build by pushing a trivial commit to `master`:
  ```
  git commit --allow-empty -m "chore: trigger cloudflare workers build test"
  git push origin master
  ```
- [ ] **7.6** In Cloudflare dashboard → Workers Builds → confirm build passes and new deployment appears.

  **Edge case — Cloudflare Workers Builds vs Pages confusion:**
  Workers Builds is under **Workers & Pages → your specific worker → Settings → Build**. Do NOT create a new "Pages" project — that's a separate product and won't use the `wrangler.jsonc` config.

  **Edge case — build fails with `astro:env` error:**
  The CI error will say something like `Missing required environment variable SUPABASE_URL`. Add the build-time env vars in step 7.4 — they are separate from the runtime secrets.

---

## Phase 8 — Rollback Procedure (Reference)

In case a deploy is bad:

```
# Revert to previous deployment (instant, ~30 sec)
npx wrangler rollback

# Or to a specific version
npx wrangler versions list
npx wrangler rollback <VERSION_ID>
```

Supabase migrations do NOT roll back automatically — coordinate schema changes manually if needed.

---

## Risk Watch

| Risk | Signal | Action |
|---|---|---|
| CPU time limit (Error 1101) | `wrangler tail --status error` | Upgrade to Workers Paid ($5/mo) |
| Bundle > 10 MB | dry-run output | Lazy-load chart components |
| `nodejs_compat` stripped | `Buffer is not defined` runtime error | Restore flag in `wrangler.jsonc` |
| Session not persisting | Re-login after navigation | Set Site URL in Supabase Auth config |
| Build-time env vs runtime secrets confusion | CI build fails | Build env vars in Cloudflare dashboard ≠ wrangler secrets |
