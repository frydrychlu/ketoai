# Session summary — 2026-06-09: the data-isolation foundation

> A plain-language recap of what we built, plus a beginner's primer on databases and
> Supabase so the rest makes sense. Re-read this anytime. Nothing here is jargon you
> need to memorize — it's here so you can look it up.

---

## Part 1 — Databases & Supabase, explained from zero

### What is a database?

Think of a database as a set of **spreadsheets that a program manages for you**.

- A **table** = one spreadsheet (e.g., a "meals" sheet).
- A **column** = a labeled field every row must fit (e.g., `name`, `calories`).
- A **row** = one record (e.g., one meal you logged).

That's 90% of it. Your whole app is really just "put rows in tables, read them back later."

### What is Postgres?

**Postgres** (full name PostgreSQL) is the specific *brand* of database your project uses.
It's the most popular open-source one — rock solid, free, used by huge companies. When
people say "the database" in this project, they mean a Postgres database.

### What is Supabase, then?

Supabase is a **company that hosts a Postgres database for you in the cloud**, and bundles
some extra conveniences around it so you don't have to build them yourself:

1. **The database** — your Postgres, running on their servers (you don't manage a server).
2. **Auth** — a ready-made login system (sign up, log in, passwords, sessions).
3. **An API** — an automatic way for your app to read/write the database over the internet.
4. **A dashboard** — the website (supabase.com/dashboard) where you can click around, run
   queries in the "SQL Editor", see your tables, see your users, etc.

So "Supabase" ≈ "my cloud Postgres database + login system + dashboard."

> **Important detail for our project:** you use Supabase **only in the cloud**. Some setups
> also run a *local* copy on your computer using Docker — you don't have that, and that's
> totally fine. It just changes *how* we send database changes up (more on that below).

### The one table you already had: `auth.users`

Before this session, your database had exactly **one** table that mattered: `auth.users`.
That's Supabase's built-in list of everyone who has signed up. Every user gets a unique ID
(a long string called a **UUID**, like `a1b2c3d4-...`). Remember that ID — it's the key to
everything we built. "This meal belongs to *that* user ID" is how privacy works.

---

## Part 2 — The three new ideas we used this session

### Idea 1: A "migration" = a recorded recipe for changing the database

You *could* change your database by clicking buttons on the Supabase website. But then:
- there's no record of what you did,
- you can't easily repeat it,
- and your teammates (or future you) have no idea what changed.

Instead, the professional way is a **migration**: you write the change as a **`.sql` file**
saved inside your project (and in git). `.sql` is just the language databases speak —
"create a table", "add a column", etc.

We created your first one:
```
supabase/migrations/20260609151323_isolation_canary.sql
```
The weird number at the front is just a **timestamp** (`2026-06-09 15:13:23`). It makes
migrations run in the right order — like numbered chapters in a recipe book.

### Idea 2: "RLS" = a security guard on every single row

Here's the scary part of any health app: **how do you guarantee User A never sees User B's
private data?** The naive answer is "my app code will be careful." That's not good enough —
one bug and you leak medical data.

The real answer is **Row Level Security (RLS)**. It's a rule you switch on *inside the
database itself*. Once on, the database refuses to hand back any row unless a rule explicitly
allows it. Even if your app code has a bug, the database itself is the last line of defense.

The rules are called **policies**. We wrote four of them — one for each thing you can do:
- **SELECT** (read): "you may read a row only if you own it"
- **INSERT** (create): "you may create a row only with your own name on it"
- **UPDATE** (edit): "you may edit a row only if you own it"
- **DELETE** (remove): "you may delete a row only if you own it"

Every rule is the same simple test: **`auth.uid() = user_id`**, which reads as
*"the currently-logged-in user's ID equals the owner ID stored on this row."*
`auth.uid()` is a built-in function that means "who is asking right now?"

### Idea 3: The "canary table" = a tiny practice table to prove RLS works

We didn't want to build the real `meals` table yet (that's a later feature). But we *did*
want to prove the security pattern works before betting real health data on it.

So we built a tiny throwaway table called **`isolation_canary`** with just three columns:
`id` (a unique row ID), `user_id` (who owns it), and `label` (any text). We put the four RLS
policies on it and tested them. The name "canary" is from "canary in a coal mine" — a small,
safe thing you use to check that the environment is safe before you rely on it.

---

## Part 3 — What we actually did, in order

| # | What happened | Why it mattered |
|---|---------------|-----------------|
| 1 | Started planning the **meal feature** | It's the first real feature on your roadmap |
| 2 | Found the **database foundation was missing** | You can't store private data safely without it — so we paused the meal feature |
| 3 | **Planned** the foundation (`data-isolation-baseline`) | Wrote down exactly what to build + how to verify it, before touching code |
| 4 | Wrote the **first migration** (canary table + 4 RLS policies) | Created the actual database change as a recorded file |
| 5 | **You** connected & uploaded it (see commands below) | The table went live in your real cloud database |
| 6 | **You** ran a test script with 2 users | Proved User B literally cannot see User A's rows |
| 7 | Documented the pattern in `AGENTS.md` | Every future table now copies this exact safe recipe |
| 8 | Committed everything to git (3 commits) | The work is saved and recorded |

---

## Part 4 — The commands you ran, demystified

These three tripped us up, so here's what each one actually does:

```
npx supabase login
```
**"Prove to Supabase that it's really me."** Opens a browser, you approve. One-time per
computer. (It failed at first because we tried to run it *inside* the chat, which has no
browser — running it in your own terminal fixed it.)

```
npx supabase link --project-ref yzgiecnueavvqmybvexh
```
**"Connect this project folder to that specific cloud database."** The `project-ref` is your
database's unique name (it's the part in your Supabase URL). It asks for your **database
password** — a separate password from your Supabase login, used to talk directly to Postgres.

```
npx supabase db push
```
**"Run any new migration recipe files against the cloud database."** This is the moment your
`.sql` file actually executed and the table appeared in the cloud.

### The credential confusion we hit (worth understanding)

There are **three different "passwords"** in Supabase, and mixing them up is the #1 beginner
trap. Here's the cheat sheet:

| Credential | What it's for | Lives where |
|---|---|---|
| `SUPABASE_KEY` (the `sb_publishable_...` in your `.env`) | Lets your **running app** talk to the database as an anonymous visitor. Low-secrecy. | `.env` |
| **Database password** | Lets the **CLI** connect directly to Postgres to run migrations (`db push`). | You typed it during `link` |
| **Access token** (`sbp_...`) | Lets the **CLI** prove who you are without a browser. | Only needed for the non-browser path |

The `.env` key was **not enough** for `db push` because that key is just for your app's
everyday read/write traffic — it has no power to *change the structure* of the database.

---

## Part 5 — Where everything lives now

```
supabase/
  migrations/
    20260609151323_isolation_canary.sql   <- the recipe that created the table + security
  tests/
    isolation_canary_rls.sql              <- the script that PROVES one user can't see another's data
AGENTS.md                                  <- now has a "Data Isolation & Migration Pattern" section (the reusable blueprint)
context/changes/data-isolation-baseline/
  plan.md         <- the detailed plan (with a checked-off Progress section)
  plan-brief.md   <- the 2-minute version
  change.md       <- status: implemented
```

Git commits from this session:
- `a26e8ac` — Phase 1: migration workflow + canary table with RLS
- `00037a0` — Phase 2: verification script + AGENTS.md docs
- `f6db9e6` — epilogue: close out the plan

---

## Part 6 — Honest caveats

1. **We only tested the "reading" side of security.** We proved nobody can *read* someone
   else's rows. The rules to block *writing* to someone else's rows exist, but we didn't run
   a specific test for them. When we build the real `meals` table, we should add that test.
   (This was a deliberate "keep it lean today" choice — it's noted in the plan.)
2. **Some unrelated files are still uncommitted** in your project (leftover skill installs,
   `CLAUDE.md`, and the half-planned `meal-macro-logging` folder). We left those alone on
   purpose — deal with them whenever you like.

---

## Part 7 — What's next (when you're ready)

The foundation is done, so the **meal feature is unblocked**. Next time you'd run:
```
/10x-plan meal-macro-logging
```
The decisions you already made earlier in the session (how the AI reads your meal text and
turns it into macros) are saved in that change's notes, waiting for you.

---

## Mini-glossary

- **Database** — managed set of spreadsheet-like tables.
- **Postgres / PostgreSQL** — the brand of database this project uses.
- **Supabase** — company hosting your Postgres in the cloud + login + dashboard + API.
- **Table / row / column** — a sheet / one record / one labeled field.
- **`auth.users`** — Supabase's built-in table of everyone who signed up.
- **UUID** — a long unique ID string, e.g. `a1b2c3d4-...`; every user has one.
- **SQL** — the language databases speak ("create table...", "select...").
- **Migration** — a `.sql` file recording a database change, kept in git.
- **CLI** — "Command Line Interface"; the `npx supabase ...` commands you typed.
- **RLS (Row Level Security)** — database-enforced rule: you only touch rows you own.
- **Policy** — one RLS rule (we made four: read / create / edit / delete).
- **`auth.uid()`** — built-in function meaning "the ID of whoever is asking right now."
- **Canary table** — small throwaway table used to safely test the security pattern.
