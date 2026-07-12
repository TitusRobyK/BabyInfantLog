# Google Sign-In Setup

This guide configures Google Sign-In for Baby Log using Google Auth Platform and the hosted Supabase project.

The application only needs the parent's basic identity: name, email address, and profile. Do not enable Gmail, Drive, Calendar, Contacts, or other Google APIs.

## Configuration template

| Setting | Value |
|---|---|
| Application type | Web application |
| Local origin | `http://localhost:5173` |
| Optional local origin | `http://127.0.0.1:5173` |
| Supabase callback | `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` |
| Parent A test account | `PARENT_A_TEST_EMAIL` |
| Parent B test account | `PARENT_B_TEST_EMAIL` |

Before using the guide, replace every uppercase placeholder:

- `YOUR_PROJECT_REF` — the Supabase project reference shown in the project URL.
- `PARENT_A_TEST_EMAIL` and `PARENT_B_TEST_EMAIL` — the Google accounts allowed during testing.
- `[YOUR_NETLIFY_ORIGIN]` — the production origin, such as `https://baby-log-example.netlify.app`.

An origin contains the scheme and hostname, with no path, wildcard, or trailing slash. Never commit the resulting client secret or a downloaded Google credentials file.

## 1. Create or select a Google Cloud project

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview).
2. Open the project selector at the top of the page.
3. Select an existing project or choose **New Project**.
4. If creating a project, use:
   - Project name: `Baby Log`
   - Organization: leave the default selection
5. Select **Create**.
6. Confirm that the Baby Log project is now selected in the header.

## 2. Initialize Google Auth Platform

If Google displays **Get started**:

1. Select **Get started**.
2. Under **App Information**, enter:
   - App name: `Baby Log`
   - User support email: the email used to administer the application
3. Select **Next**.
4. For **Audience**, choose **External**.
5. Select **Next**.
6. Under **Contact Information**, enter the developer contact email.
7. Select **Next**.
8. Accept the Google API Services User Data Policy.
9. Select **Continue**, then **Create**.

Use **External** because the parents use separate consumer Google accounts. **Internal** is limited to accounts in the same Google Workspace organization.

## 3. Configure the audience

1. Open **Audience** from the Google Auth Platform navigation.
2. Confirm:
   - User type: **External**
   - Publishing status: **Testing** during initial setup
3. Find **Test users** and select **Add users**.
4. Add:

   ```text
   PARENT_A_TEST_EMAIL
   PARENT_B_TEST_EMAIL
   ```

5. Select **Save**.

Before relying on Google Sign-In for daily production use, return to this screen and select **Publish app** or **Publish to production**. Keep the application limited to the basic identity scopes described below.

## 4. Configure data access

1. Open **Data Access**.
2. Select **Add or remove scopes**.
3. Confirm that these scopes are selected:

   ```text
   openid
   https://www.googleapis.com/auth/userinfo.email
   https://www.googleapis.com/auth/userinfo.profile
   ```

   The email and profile scopes may already be selected. Add `openid` manually if it is missing.

4. Select **Update** or **Save**.

Do not add Gmail, Drive, Calendar, Contacts, sensitive, or restricted scopes. Baby Log does not need access to the contents of the parent's Google account.

## 5. Configure branding

1. Open **Branding**.
2. Confirm:
   - App name: `Baby Log`
   - User support email: the support email for the app
   - Developer contact email: the administrator email
3. The logo and public application URLs can remain empty while initially testing if Google marks them optional.
4. Once a permanent production domain is available, optionally add:
   - Application home page
   - Privacy policy URL
   - Terms of service URL
   - Authorized domain

Displaying custom public branding may require Google's brand-verification process. Do not delay initial private testing on optional branding.

## 6. Create the OAuth client

1. Open **Clients**.
2. Select **Create client**.
3. For **Application type**, choose **Web application**.
4. Set the client name to `Baby Log Web`.

Do not create Android or iOS clients for this application. Baby Log remains a web application when opened in a browser or installed as a PWA.

## 7. Add authorized JavaScript origins

Under **Authorized JavaScript origins**, select **Add URI** for each applicable origin.

Add the local development origin:

```text
http://localhost:5173
```

If local testing sometimes uses `127.0.0.1`, also add:

```text
http://127.0.0.1:5173
```

Add the production Netlify origin when it is known:

```text
[YOUR_NETLIFY_ORIGIN]
```

If a custom production domain is used, add it separately:

```text
https://your-domain.example
```

For Google authorized JavaScript origins:

- Do not include a path.
- Do not add `/**`.
- Do not add a trailing slash.
- Add each origin separately.
- Do not add individual Netlify preview deployment URLs.

## 8. Add the Supabase callback

Under **Authorized redirect URIs**, select **Add URI** and enter exactly:

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

Verify that it:

- Uses `https`.
- Contains the correct Supabase project reference.
- Ends with `/auth/v1/callback`.
- Has no trailing slash after `callback`.

Do not enter the Netlify URL in this field. Google sends the authentication result to Supabase first, and Supabase then returns the parent to Baby Log.

The locally running frontend uses the hosted Supabase project, so do not add `http://127.0.0.1:54321/auth/v1/callback`. That callback is only for a Supabase stack running locally.

## 9. Create and protect the credentials

1. Select **Create**.
2. Copy the generated:
   - Client ID
   - Client secret
3. Store them in a password manager until they are added to Supabase.

The client secret must never be:

- Added to the application repository.
- Stored in a frontend `VITE_` environment variable.
- Added to frontend source code.
- Committed as a downloaded credentials JSON file.
- Shared in chat, screenshots, or issue trackers.

## 10. Add the Google credentials to Supabase

1. Open the Baby Log project in Supabase.
2. Go to **Authentication → Sign In / Providers**. In some dashboard versions this is labelled **Authentication → Providers**.
3. Open **Google**.
4. Enable the provider.
5. Paste the Google:
   - Client ID
   - Client secret
6. Select **Save**.
7. Confirm that the callback displayed by Supabase is:

   ```text
   https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
   ```

If Supabase displays a different callback, treat the value shown by Supabase as authoritative and update the Google OAuth client to match it exactly.

## 11. Configure Supabase redirect URLs

1. In Supabase, open **Authentication → URL Configuration**.
2. Set **Site URL** to the production Netlify origin.
3. Under **Redirect URLs**, add:

   ```text
   http://localhost:5173/**
   http://127.0.0.1:5173/**
   [YOUR_NETLIFY_ORIGIN]/**
   ```

4. If Netlify deploy previews require Google authentication, optionally add:

   ```text
   https://**--YOUR-NETLIFY-SITE.netlify.app/**
   ```

Use an exact production URL. Restrict wildcards to controlled local and Netlify preview addresses.

Google and Supabase use different URL formats:

- Google authorized JavaScript origin: plain origin, for example `http://localhost:5173`.
- Google authorized redirect URI: the exact hosted Supabase callback.
- Supabase redirect URL: may include `/**` to allow application paths.

## 12. Configuration verification

Before application integration, verify:

- The correct Google Cloud project is selected.
- The audience is External.
- Both parent emails are listed as test users during testing.
- Only `openid`, email, and profile scopes are enabled.
- The OAuth client type is Web application.
- The local and production origins contain no paths or wildcards.
- Google's redirect URI exactly matches the Supabase callback.
- The client secret exists only in Supabase and a secure password manager.
- Supabase Site URL points to the production application.
- Local and production application URLs are allowed by Supabase.

Once these checks pass, the `Continue with Google` action in the login, create-family, and join-family journeys is ready to use.

## Official references

- [Supabase: Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase: Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Google: Manage OAuth clients](https://support.google.com/cloud/answer/15549257)
- [Google: OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
- [Google: Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
