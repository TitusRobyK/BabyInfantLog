# Deployment Runbook

This runbook deploys the Baby Infant Log to Supabase and Netlify. Complete the steps in order because production Auth redirects depend on the final Netlify URL.

## 1. Prerequisites

- Node.js 22.12 or later
- A Supabase account and new project
- A Netlify account
- A GitHub, GitLab, or Bitbucket repository for continuous deployment, or the Netlify CLI for a manual deploy
- A production SMTP provider for verification and password-reset email
- A Cloudflare Turnstile site for production CAPTCHA

## 2. Verify the application locally

From the project root:

```bash
npm install
npm run check
npm test
npm run build
```

The production output is generated in `dist/`.

## 3. Create and configure Supabase

1. Create a Supabase project and save its project reference.
2. From **Project Settings → API**, copy:
   - Project URL
   - Publishable key (`sb_publishable_...`)
   - Service-role key; keep this secret and never put it in `.env` with a `VITE_` prefix
3. Apply the checked-in database migration:

   ```bash
   npx supabase@latest login
   npx supabase@latest link --project-ref YOUR_PROJECT_REF
   npx supabase@latest db push
   ```

4. In **Authentication → Providers → Email**:
   - Enable email/password signup
   - Require email confirmation
   - Enable secure password changes
   - Set minimum password length to 12
   - For Google Sign-In, complete [GOOGLE_AUTH.md](./GOOGLE_AUTH.md), then enable the Google provider with its client ID and secret
5. In **Authentication → URL Configuration**, initially set:
   - Site URL: your temporary Netlify production URL, added after the first deploy
   - Redirect URLs:
     - `http://localhost:5173/**`
     - `http://localhost:8888/**`
     - `https://YOUR-SITE.netlify.app/**`
     - Your final custom domain, if any
   - Use an exact production domain. Limit wildcard URLs to controlled Netlify deploy previews.
6. Configure a production SMTP provider in **Authentication → SMTP Settings**. Verify both confirmation and password-reset templates. Supabase's built-in sender is for initial testing only.
7. Create a Cloudflare Turnstile site for the production domain. In Supabase **Authentication → Bot and Abuse Protection**, enable CAPTCHA with the Turnstile secret.
8. In Supabase Auth password-security settings, enable leaked-password protection if the project plan supports it.

The migration enables RLS, private invitation tables, two-parent constraints, Realtime publications, and transactional family/session functions. Do not manually disable RLS to work around an error.

## 4. Create local environment values

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
VITE_TURNSTILE_SITE_KEY=YOUR_TURNSTILE_SITE_KEY
```

To test Netlify Functions locally, also set the non-browser variables in a local Netlify environment or `.env` that is never committed:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=REPLACE_ME
INVITE_HMAC_SECRET=REPLACE_ME
```

Generate the HMAC secret with:

```bash
openssl rand -hex 32
```

Start the full Netlify environment with:

```bash
npx netlify-cli dev
```

Netlify Dev normally serves the site on `http://localhost:8888` and routes `/api/family-invite` to the local function.

## 5. Deploy to Netlify

### Continuous deployment

1. Initialize and push this directory to a private Git repository if it is not already under Git.
2. In Netlify, choose **Add new project → Import an existing project** and select the repository.
3. Netlify reads `netlify.toml`; confirm:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
   - Node version: 22
4. In **Project configuration → Environment variables**, add:

   | Variable | Scope | Secret? |
   |---|---|---|
   | `VITE_SUPABASE_URL` | Builds | No |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Builds | No, but keep project-scoped |
   | `VITE_TURNSTILE_SITE_KEY` | Builds | No |
   | `SUPABASE_URL` | Functions | No |
   | `SUPABASE_SERVICE_ROLE_KEY` | Functions | Yes |
   | `INVITE_HMAC_SECRET` | Functions | Yes |

5. Trigger a production deploy.

### Manual CLI deployment

If continuous deployment is not yet configured:

```bash
npx netlify-cli login
npx netlify-cli init
npx netlify-cli deploy --build --prod
```

Never place the service-role key or HMAC secret in `netlify.toml`, source files, build logs, or variables prefixed with `VITE_`.

## 6. Finish production Auth configuration

After Netlify assigns the production URL:

1. Return to Supabase **Authentication → URL Configuration**.
2. Set Site URL to `https://YOUR-SITE.netlify.app` or the custom production domain.
3. Add `https://YOUR-SITE.netlify.app/**` to Redirect URLs.
4. Update the Turnstile allowed hostname to the same production domain.
5. Trigger a fresh Netlify deploy if any `VITE_` value changed.

## 7. Verify the deployed functions

In Netlify **Functions** confirm:

- `family-invite` is deployed at `/api/family-invite`
- `daily-summary` has a Scheduled badge and a next-run time

Use **Run now** on `daily-summary` to verify it executes. A brief is generated only when a household's saved local hour is 8 PM; the function may legitimately report zero generated briefs at other times.

Check function logs for configuration errors, but never log raw signup codes, emails, access tokens, event detail, or secret values.

## 8. Production acceptance test

Use two real email accounts and both target phones.

1. On Parent A's device:
   - Create an account and verify the email
   - Create the parent profile and baby
   - Enter Parent B's exact email and generate the family code
2. On Parent B's device:
   - Create and verify a separate account using the invited email
   - Enter the code, confirm the baby, and join
3. Confirm both devices see the same existing history.
4. Log Poop, Pee, Feed, Burp, and Diaper check from both devices.
5. Log Feed, optionally record breast milk/formula and consumed ml, and confirm closing or choosing **Save without amount** keeps the feed.
6. Start Sleep on one device and confirm the other device adopts the active state. Start an interruption, resume sleep from the other device, and verify net sleep time and interruption count. End sleep while an interruption is active and confirm both close safely.
7. Start and end Pump from the Mother profile, then add amount and side.
8. Put one phone in airplane mode, log a discrete event, restore connectivity, and confirm it syncs exactly once.
9. Edit and remove an event, then test Restore.
10. Verify Day, Week, and Month trends.
11. Test forgot-password and reset links from both iOS Mail/Safari and Android Mail/Chrome.
12. Add the app to both home screens and repeat a one-tap event.
13. Confirm an unlinked third account can see no household, infant, event, interruption, summary, or Realtime data.
14. Attempt invalid family codes until the rate limit is reached and confirm the response remains generic.

## 9. Daily operations

- Review failed function invocations and Supabase Auth/database logs.
- Keep the Supabase service-role key and HMAC secret in Netlify only.
- Rotate the HMAC secret only when no active family code exists; existing codes become invalid after rotation.
- Review Supabase backups and perform a restore exercise before relying on the app as the only record.
- Deploy schema changes through new migration files; never edit the applied migration in place.
- Use Netlify's previous production deploy to roll back frontend/functions. Database migrations require a separate forward-fix or reviewed rollback migration.

## 10. Custom domain

When moving from the Netlify hostname to a custom domain, update all of these together:

- Supabase Site URL
- Supabase Redirect URLs
- Turnstile allowed hostname
- Any SMTP template links
- Netlify domain configuration

Then test signup, verification, login, reset password, family-code linking, and PWA installation again.
