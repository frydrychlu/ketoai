---
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
---

## Why this stack

KetoAI is a solo, 6-week, after-hours web app targeting small user scale with a privacy-first constraint: each user sees only their own health data. The 10x Astro Starter ships exactly the primitives this project needs — Supabase provides PostgreSQL with Row-Level Security for strict per-user data isolation, built-in email/password auth for FR-001/002, and a typed TypeScript SDK; Astro 6 + React 19 handles the interactive dashboard, trend charts, and daily logging forms; Cloudflare Pages delivers a zero-config global deployment on the free tier. The AI feature set (macro parsing and on-demand correlation analysis via the Anthropic API) layers on top as Astro API routes with no additional infrastructure. TypeScript throughout and Zod at the API boundaries give agents explicit schemas to reason from, reducing drift in an after-hours solo build where review bandwidth is tight.
