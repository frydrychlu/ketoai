# Local development flow (Supabase + Docker)

Local-first workflow: build and test against a **local** Supabase database, push migrations to the **cloud** only when merging to `master`.

## Daily loop

```bash
# 1. Start Docker Desktop (the app), wait until it says "running".

# 2. Bring up the local Supabase stack (auto-applies all migrations).
npx supabase start

# 3. Run the app against local.
npm run dev

# 4. When done for the day, free the RAM (~7 GB).
npx supabase stop
```

| Service | URL |
| --- | --- |
| App (dev) | http://localhost:4321 |
| Supabase API | http://127.0.0.1:54321 |
| Studio (DB UI) | http://127.0.0.1:54323 |

## Working on the database

```bash
# Author a migration file in supabase/migrations/  (name: YYYYMMDDHHmmss_short_description.sql)

# Wipe local DB and replay ALL migrations from scratch — your safe "undo".
npx supabase db reset

# Run raw SQL against the local DB (no psql on PATH; use the container).
docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres
```

To test RLS / per-user data locally you need real users: just **sign up through the app** (now pointed at local), or add them in Studio → Authentication.

## Shipping to cloud (after merge to `master`)

```bash
# One-time setup per machine:
npx supabase login
npx supabase link --project-ref yzgiecnueavvqmybvexh   # needs the DB password

# Send new migrations to the cloud DB. Forward-only — rollback = a new migration.
npx supabase db push
```

## The credential rule (avoids the #1 trap)

- **`.env` / `.dev.vars` always point at LOCAL** while developing. Cloud values are kept commented in those files for easy toggling.
- **`db push` reaches the cloud via the linked project + DB password — NOT via `.env`.** They never interfere.
- **Production** reads Cloudflare secrets, not `.env`.

| Channel | Points at | Configured by |
| --- | --- | --- |
| App in dev | Local | `.env` + `.dev.vars` |
| `db push` (migrations) | Cloud | `supabase link` + DB password |
| App in production | Cloud | Cloudflare secrets |
