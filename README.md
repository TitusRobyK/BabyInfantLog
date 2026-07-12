# Baby Infant Log

A minimal, mobile-first shared infant care log for two parents. The app supports Google or email/password accounts, secure family linking, one-tap care events, optional Feed volume, Sleep interruptions, Sleep and Pump sessions, offline retry, shared history, trends, and an 8 PM daily brief.

## Stack

- Svelte 5, Vite, and TypeScript
- Supabase Auth, Postgres, Row Level Security, and Realtime
- Netlify static hosting and Functions
- IndexedDB offline queue and installable PWA shell

## Local setup

1. Install Node.js 22 or later.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and add the Supabase project URL and publishable key.
4. Start the frontend:

   ```bash
   npm run dev
   ```

For the complete Supabase, Netlify, Auth, SMTP, CAPTCHA, and production verification procedure, see [DEPLOYMENT.md](./DEPLOYMENT.md). For Google OAuth setup, use [GOOGLE_AUTH.md](./GOOGLE_AUTH.md).

## Set up the database schema

After linking the repository to a Supabase project, preview the pending schema migrations and then apply them:

```bash
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
npm run db:setup:dry-run
npm run db:setup
```

`db:setup` is the repository's single schema-install command. It applies every pending file in `supabase/migrations/` in order and records it in Supabase migration history. It never runs the seed, cleanup, or wipe utilities under `supabase/scripts/`.

## Reset a disposable test database

The wipe command deletes all application rows **and every Supabase Auth user** in the selected project. Never point it at a production or shared project.

With PostgreSQL `psql` installed, set the full Supabase database connection string without committing it, then run:

```bash
export SUPABASE_DB_URL='postgresql://postgres.PROJECT_REF:YOUR_PASSWORD@HOST:6543/postgres'
npm run db:wipe:test
unset SUPABASE_DB_URL
```

Use the Session pooler or direct connection string shown under **Supabase → Connect**. The checked-in SQL is `supabase/scripts/wipe-test-data.sql`; review the target project and the script before every run. After the wipe, signup/onboarding starts from a completely empty state. Migrations and database structure remain intact.

## Add 30 days of newborn UI test data

The seed fixture creates synthetic data for the project's single active baby across the latest 30 calendar days. It includes varied Feed amounts/types, Burps, Pee, Poop, diaper checks, completed Sleep sessions and interruptions, optional Pump sessions for a Mother profile, and past 8 PM briefs.

It is safe to rerun: every row it owns is tagged, and a rerun replaces only those synthetic rows. It does not delete manually logged events or change the baby's birth date. Do not use the fixture as medical guidance or as a real care record.

With the database connection already exported as described above:

```bash
npm run db:seed:test
```

The project must contain exactly one active child and at least one linked parent. The script intentionally leaves the latest Feed without a subsequent Burp so the 15-minute Quick update reminder is visible.

If `psql` is unavailable, open **Supabase → SQL Editor → New query**, paste the contents of `supabase/scripts/seed-30-day-newborn-ui-data.sql`, review the target project, and select **Run**.

Before production acceptance testing, remove only the synthetic fixture while preserving accounts and manually recorded care events:

```bash
npm run db:unseed:test
```

Without `psql`, run `supabase/scripts/remove-30-day-newborn-ui-data.sql` from the Supabase SQL Editor.

## Verification

```bash
npm run verify
```

## Before the first GitHub push

1. The repository may be public, but it must never contain secrets. Do not add `.env`, `.netlify/`, `supabase/.temp/`, database dumps, private keys, or production build output.
2. Run `npm run verify` and confirm the dependency audit with `npm audit`.
3. Initialize Git, then verify that local configuration is ignored before staging:

   ```bash
   git init
   git branch -M main
   git check-ignore -v .env .netlify/state.json supabase/.temp/project-ref dist/index.html
   ```

4. Stage and review every path. `.env.example`, migrations, source files, icons, and Netlify Functions are expected; `.env`, `.netlify/`, `supabase/.temp/`, and `dist/` must remain absent:

   ```bash
   git add .
   git status --short
   git diff --cached --check
   git diff --cached --stat
   ```

5. Commit only after the staged-file review. If a real credential is ever committed, rotate/revoke it first; deleting the visible file in a later commit is insufficient because it remains in Git history.

## Main directories

- `src/` — browser application
- `netlify/functions/` — privileged invitation flow and scheduled daily brief
- `supabase/migrations/` — database schema, constraints, RLS, and transactional functions
- `supabase/scripts/` — explicitly invoked database maintenance scripts
- `public/` — PWA/static assets
- `PRODUCT_SPEC.md` — product, UX, security, and acceptance specification
- `GOOGLE_AUTH.md` — Google Auth Platform and Supabase OAuth setup

## Security boundary

The Supabase publishable key is intentionally used by the browser and is safe only because every exposed table is protected with Row Level Security. The Supabase service-role key and invitation HMAC secret must exist only in Netlify's protected environment variables.
