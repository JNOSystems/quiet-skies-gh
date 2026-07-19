# Quiet Skies Granada Hills

Mobile-first community aircraft-noise reporting for Granada Hills.

- Public site: https://www.quietskiesgh.org
- Apex redirect: https://quietskiesgh.org
- Repository: `JNOSystems/quiet-skies-gh`

The app records a database-generated timestamp, one approved Granada Hills zone,
and a random submission UUID used only for duplicate prevention. It does not ask
for a name, email, address, login, precise location, or aircraft identifier.

## Secure Reporting Architecture

The browser has read-only access to the public report data needed for dashboard
counts and Recent Reports. It must never insert directly into `public.reports`.

The accepted write path is:

1. The browser generates one submission UUID for a new complaint.
2. Cloudflare Turnstile generates a fresh, single-use token for that attempt.
3. The browser sends only `zone`, `submissionId`, and `turnstileToken` to
   `POST /api/report`.
4. The Netlify Function validates the body and Turnstile result.
5. The function derives an HMAC-SHA256 source hash from Netlify `context.ip`.
6. The function calls the service-role-only `submit_community_report` RPC.
7. PostgreSQL atomically applies the circuit breaker, idempotency, source limits,
   global limit, zone allowlist, and server timestamp.

The raw IP address and Turnstile token are never stored or logged. The private,
short-lived HMAC rate-limit record is not stored with the community complaint.

`Retry this report` keeps the unresolved submission UUID and obtains a fresh
Turnstile token. `Log a new complaint` discards the unresolved UUID and creates
a new one.

## Required Netlify Variables

Configure these in Netlify. Secret values must include the Functions scope.

| Variable | Scope | Purpose |
|---|---|---|
| `SUPABASE_URL` | Functions | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Functions, secret | Server-only Supabase secret key |
| `TURNSTILE_SECRET_KEY` | Functions, secret | Server-side Turnstile validation |
| `RATE_LIMIT_HMAC_SECRET` | Functions, secret | At least 32 random characters |
| `SUBMISSIONS_ENABLED` | Functions | Exact string `false` until production verification |
| `TURNSTILE_SITE_KEY` | Builds | Public widget site key written to `runtime-config.js` |

Never put server secrets in `netlify.toml`, HTML, browser JavaScript, GitHub, or
the Netlify publish directory. The function sends a Supabase secret key only in
the `apikey` header.

Production Turnstile validation requires:

- Hostname: `www.quietskiesgh.org`
- Action: `quiet-skies-report`

## Deploy Preview Testing

Cloudflare's official test credentials may be configured only for the Netlify
Deploy Preview context:

- Site key: `1x00000000000000000000AA`
- Secret key: use Cloudflare's official always-pass test secret from its
  [Turnstile testing documentation](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)

The function accepts the official test response (`localhost`, action `test`)
only when the request hostname matches Netlify's Deploy Preview hostname format.
Production builds reject Cloudflare test site keys.

Keep the preview connected to a non-production Supabase project or leave
`SUBMISSIONS_ENABLED=false`. Do not create test complaints in production.

## Supabase Migration

Migration:

`supabase/migrations/20260719_secure_report_submission.sql`

Execution order:

1. Confirm `anon` and `authenticated` have no table-level or column-level
   `INSERT` privilege on `public.reports`.
2. Record the current `public.reports` row count, RLS state, policy definitions,
   and `reports_submission_id_unique` definition.
3. Run the migration in the Supabase SQL Editor.
4. Run every verification query included in the migration.
5. Confirm the private tables are inaccessible to `PUBLIC`, `anon`, and
   `authenticated`.
6. Confirm only `service_role` can execute `submit_community_report`.
7. Confirm both the database and Netlify circuit breakers remain disabled.

The migration must not be applied by an automated build or deployment. Never
restore direct anonymous INSERT privileges.

## Build And Test

```powershell
npm test
npm run build
```

The build recreates `dist/` with exactly:

```text
dashboard_periods.js
icon.svg
index.html
manifest.json
runtime-config.js
secure_report_client.js
sw.js
```

Netlify deploys functions separately from `netlify/functions`. Tests, SQL,
internal notes, Git data, incident evidence, and source-only files are not
published.

## Production Release Checklist

1. Open and test the draft PR Deploy Preview.
2. Confirm all GitHub checks pass.
3. Confirm production Netlify variables exist and `SUBMISSIONS_ENABLED=false`.
4. Apply and verify the Supabase migration manually.
5. Merge only after approval. Merging `main` triggers Netlify production deploy.
6. Verify the site, assets, service worker, `/api/report` 503 response, dashboard,
   zone selection, retry panel, and official LAWA follow-through.
7. Enable the database circuit breaker:

   ```sql
   update qsgh_private.report_submission_settings
   set submissions_enabled = true,
       updated_at = clock_timestamp()
   where singleton = true;
   ```

8. Set Netlify `SUBMISSIONS_ENABLED=true` and trigger a new production deploy.
9. Submit one approved live verification report, confirm one database row, and
   retry the same UUID to confirm duplicate acceptance without a second row.
10. Recheck dashboard totals and function logs. Logs must contain no raw IP or
    Turnstile token.

## Emergency Pause

1. Set Netlify `SUBMISSIONS_ENABLED=false`.
2. Trigger a production deploy so the function receives the updated value.
3. Disable the database circuit breaker using the SQL in the migration.
4. Confirm `/api/report` returns HTTP 503.

Pausing reporting must not affect public dashboard reads or official external
links.

## Rollback

1. Pause both circuit breakers.
2. Revert the frontend/function release with a normal Git revert; do not rewrite
   history or force push.
3. Redeploy the last known-good frontend.
4. Roll back database security objects only after the frontend no longer calls
   `/api/report`, using the migration's rollback section.
5. Do not delete or rewrite complaint records.
6. Do not restore anonymous INSERT as a rollback shortcut.

Official references:

- [Netlify Functions API](https://docs.netlify.com/build/functions/api/)
- [Cloudflare Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Supabase API key security](https://supabase.com/docs/guides/getting-started/api-keys)
