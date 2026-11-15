# QSGH Agent Manual

This file defines the operating rules, privacy rules, deployment workflow, QA checklist, and Codex behavior expectations for the Granada Hills Quiet Skies / Aircraft Noise Logger project.

## 1. Project Identity

- Project name: Granada Hills Quiet Skies
- Alternate working name: Quiet Skies / Aircraft Noise Logger
- Primary role of this agent: Manage planning, QA, code-change requests, deployment checks, copy edits, and feature specifications for the app.
- GitHub repo: `JNOSystems/quiet-skies-gh`
- Public site: `https://www.quietskiesgh.org`
- Apex redirect: `https://quietskiesgh.org` redirects to `https://www.quietskiesgh.org`
- Netlify fallback: `https://quiet-skies-gh.netlify.app`
- Primary maintainer: Jon

## 2. App Purpose

- The app exists to help Granada Hills residents document community aircraft noise.
- The app is for local community logging and documentation first.
- The app may point users to official complaint systems, but it must not blur local logging with official filing.
- The app must maintain civic credibility through clear copy, limited data collection, and careful handling of official references.

## 3. Core User Workflow

- User opens the app on mobile first.
- User selects one required zone:
  - North
  - Central
  - South
- User taps the main CTA: `I Heard a Plane`
- Browser obtains a fresh Turnstile token and sends only zone, submission UUID, and token to `POST /api/report`.
- The Netlify Function validates the request and calls the service-role-only database RPC.
- The browser must never insert directly into `public.reports`.
- App stores a community report using the database server timestamp, selected zone, and a random non-identifying submission UUID used only for duplicate prevention.
- An unresolved network submission must offer explicit `Retry this report` and `Log a new complaint` actions; never resend or reuse it automatically.
- After logging, the app may direct the user to the official LAWA complaint flow.
- Local logging must remain separate from official complaint filing.

## 4. Privacy and Data Collection Rules

- Do not collect name, email, address, login, precise location, or aircraft ID.
- Store the server timestamp, selected zone, and a random submission UUID used only for duplicate prevention.
- Never use the submission UUID for identity, tracking, analytics, or cross-session profiling.
- Netlify may process the client IP only to verify Turnstile and derive an HMAC abuse-control hash.
- Never store or log the raw IP or Turnstile token.
- Store short-lived HMAC source hashes only in the inaccessible private rate-limit table, never with the complaint row.
- Do not add user identity collection.
- Do not add precise geolocation.
- Do not add aircraft identification unless Jon explicitly approves.
- Do not add hidden analytics or passive personal data collection.
- Any proposed schema or logging change must be reviewed against the privacy model before implementation.

## 5. Dashboard Rules

- The primary dashboard count must show `Today's Complaints` from local midnight in `America/Los_Angeles`.
- Below the primary count, the dashboard must show exactly these three summary periods:
  - `This Week`
  - `This Month`
  - `All Time`
- `This Week` starts Monday at local midnight.
- The `All Time` stat must count every valid logged report.
- Monthly complaint history must include every month from the first stored report through the current month, including zero-count months.
- Dashboard copy should stay short, clear, and mobile-readable.
- Recent Reports should remain useful and lightweight, showing recent activity without exposing personal data.

## 6. Visual Design Rules

- Keep the app mobile-first.
- Preserve the dark sky/orange civic warning visual identity.
- Preserve the bold headline style and strong CTA emphasis.
- Preserve the current community-documentation tone.
- Keep the logging workflow fast and simple.
- Make zone state visually obvious.
- Avoid adding clutter, complex flows, or desktop-first spacing that slows mobile use.

## 7. Official Complaint Routing Rules

- Keep local community logging separate from official complaint filing.
- Never invent FAA, LAWA, ANCIR, or official complaint functionality.
- Do not add FAA ANCIR unless technically feasible and explicitly approved by Jon.
- Do not modify official complaint links without verifying current public sources.
- Official complaint routing must remain clearly optional but visible after logging.
- The app may guide users to official systems, but must not claim to submit on their behalf unless that functionality is real, tested, and approved.

## 8. Netlify Deployment Rules

- Netlify is connected to GitHub and deploys `main` automatically.
- Pull requests must use Deploy Previews before production merge.
- The generated `dist/` directory must contain exactly:
  - `index.html`
  - `dashboard_periods.js`
  - `secure_report_client.js`
  - `aircraft_dashboard.js`
  - `runtime-config.js`
  - `manifest.json`
  - `sw.js`
  - `icon.svg`
- Netlify Functions deploy separately from `netlify/functions`.
- Do not include `.git`, `node_modules`, cache files, temp files, OneDrive files, or workspace files in deploy packages.
- Do not publish tests, migrations, internal documentation, incident evidence, or server secrets.
- Verify the deploy package contains the current production text before upload.
- Require review before any production deploy.

### Required secure-reporting variables

- Functions: `SUPABASE_URL`
- Functions secret: `SUPABASE_SECRET_KEY`
- Functions secret: `TURNSTILE_SECRET_KEY`
- Functions secret: `RATE_LIMIT_HMAC_SECRET`
- Functions: `SUBMISSIONS_ENABLED`
- Builds: `TURNSTILE_SITE_KEY`
- Keep `SUBMISSIONS_ENABLED=false` until the migration, Deploy Preview, production deploy, and live 503 checks are complete.
- Cloudflare official test credentials are allowed only in tests and the Deploy Preview context.

## 9. GitHub Workflow Rules

- Show `git status` before push or deploy-related approval.
- Show `git diff` before push or deploy-related approval.
- Do not push or deploy without showing git status and git diff first.
- Do not force push.
- Never merge a security pull request without explicit approval.
- Use small, understandable commits when possible.
- Keep the repo copy and any manual deploy folder aligned before release.
- If deployment is manual, confirm the deploy-ready files match the intended repo state.

## 10. Codex Change Protocol

- Translate Jon's app ideas into precise Codex-ready implementation prompts.
- Protect the app's privacy model.
- Keep the logging workflow fast and simple.
- Maintain civic credibility in wording and feature scope.
- Verify visual changes before deployment.
- Maintain a changelog of app changes.
- Create QA checklists after each update.
- Never invent FAA, LAWA, ANCIR, or official complaint functionality.
- Keep local community logging separate from official complaint filing.
- Require review before any production deploy.
- Service worker or cache changes require extra testing.

### Required response format for code-change planning

1. Goal
2. Files likely affected
3. Exact Codex prompt
4. QA checklist
5. Deployment checklist
6. Rollback note

## 11. Pre-Deploy QA Checklist

- Confirm the correct repo and branch are being used.
- Run `git status`.
- Run `git diff`.
- Confirm the primary logging flow still works:
  - zone selection required
  - `I Heard a Plane` logs successfully
  - LAWA follow-through remains available
- Confirm privacy copy is visible near the logging action.
- Confirm no name, email, address, login, precise location, or aircraft ID is being collected.
- Confirm the browser contains no direct `public.reports` insert path.
- Confirm a fresh Turnstile token is obtained on every normal or retry attempt.
- Confirm unknown Recent Reports zone values are not rendered.
- Confirm `/api/*`, `/.netlify/functions/*`, and Supabase requests bypass the service worker.
- Confirm `SUBMISSIONS_ENABLED=false` before the initial production deploy.
- Confirm dashboard labels read:
  - `Today's Complaints` as the primary count
  - `This Week`
  - `This Month`
  - `All Time`
- Confirm `All Time` uses total report count.
- Confirm mobile-first layout still feels fast and uncluttered.
- Confirm selected zone state is visually obvious.
- Confirm official complaint links were not changed unless publicly verified.
- If service worker or cache behavior changed, test fresh load, repeat load, and cache invalidation behavior.
- If using a manual Netlify deploy, inspect the exact deploy folder contents before upload.

## 12. Post-Deploy QA Checklist

- Open the live site and verify the expected release is actually visible.
- Confirm the live page text matches the intended dashboard copy.
- Confirm monthly complaint history includes zero-count months between the first report and current month.
- Confirm the live CTA appears early enough on mobile.
- Confirm logging still works end to end.
- Confirm official LAWA complaint routing remains visible after logging.
- Confirm recent reports display the intended simplified output.
- Confirm no broken assets, missing icons, or service worker regressions.
- Add a short changelog note summarizing:
  - what changed
  - when it went live
  - any follow-up checks still needed

## 13. Rollback Procedure

- Set Netlify `SUBMISSIONS_ENABLED=false` and disable the database circuit breaker first.
- Identify the last known-good version in Git or the last known-good deploy bundle.
- Confirm the rollback target before acting.
- If Git-based rollback is needed, prefer a normal revert commit over history rewriting.
- Do not force push.
- If Netlify deployment is manual, prepare the last known-good deploy folder and redeploy that package.
- After rollback, verify the live site reflects the intended prior version.
- Roll back the RPC/private tables only after frontend code no longer sends requests to `/api/report`.
- Never restore direct `anon` or `authenticated` INSERT privileges as a rollback shortcut.
- Document why the rollback happened and what must be fixed before redeploy.

## 14. Protected Incident Evidence

- Do not query, modify, expose, migrate, copy, or delete `incident.reports_abuse_20260718`.
- Incident evidence must never be included in builds, deploy artifacts, tests, logs, documentation exports, or screenshots.
