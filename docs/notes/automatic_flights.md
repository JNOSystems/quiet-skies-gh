# Automatic flights dashboard

## Change record — November 15, 2026 (pending preview review)

Added an independent Automatic Flights Detected section below the reporting
action. Today and all-time counts come from the existing public, read-only
`quiet-skies-public-aircraft` Supabase Edge Function. The latest eight detections
show Pacific dates/times and estimated height above ground. Coverage and source
are displayed separately from community complaint totals.

No database, collector, report-submission handler, or production configuration
changes are required. No aircraft identities or coordinates are exposed. A
detection does not measure noise or submit an official complaint.

The frontend requests the public summary without credentials every 30 seconds
while visible, prevents overlapping requests, and times out after 10 seconds.
Failures show unavailable values or retain explicitly labelled last available
data. A successful zero count is distinct from a failed request. The endpoint's
`asOf` is a summary query timestamp, not a collector heartbeat, so the UI does
not claim that the feed is live. Old summaries are labelled delayed.

The static build allowlist adds `aircraft_dashboard.js`. The service worker
cache changes from v5 to v6; API and Supabase requests still bypass its cache.

## QA and release gate

- Run `npm test`, `npm run build`, and `git diff --check`.
- Verify the preview at desktop and mobile widths: reporting action remains
  ahead of the aircraft section, with separate complaint counts and histories.
- Verify the actual aircraft request succeeds with the preview's Origin and
  that the rendered counts/history match its public response.
- Verify empty, unavailable, delayed, and recovered summary states in tests.
- Verify Pacific dates across DST, unknown altitude, refresh overlap prevention,
  hidden-tab pause, and service worker installation/cache invalidation/bypass.
- Exercise zone-required validation and confirm official complaint links remain
  available. Do not submit test complaints into the production database.
- Keep the PR unmerged until preview verification and release review are complete.

## Rollback

Revert this frontend change through a reviewed PR. This feature does not change
database objects, collector configuration, or reporting controls. Retain the
secure complaint submission path. Never restore direct anonymous inserts.
