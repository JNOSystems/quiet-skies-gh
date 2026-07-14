# Supabase RLS Review

Review date: 2026-07-13

Table: `public.reports`

## Verified Production State

- Pre-migration row count: `663`
- RLS enabled: `true`
- RLS forced: `false`
- `anon` has column-level `INSERT` on `zone` and `reported_at`.
- `anon` has column-level `SELECT` on `id`, `created_at`, and `zone`.
- `anon` does not have table-level `INSERT`.
- `reports_submission_id_unique` did not exist at review time.

## Policy Finding

Two permissive `INSERT` policies apply to `anon`:

- `Public can add valid reports` checks the approved Granada Hills zones, requires `reported_at`, and limits its length to 4 through 20 characters.
- `Allow anon insert` uses `WITH CHECK (true)`.

PostgreSQL combines permissive policies with `OR`. The unrestricted policy therefore makes the validation policy ineffective for columns that `anon` is allowed to insert. This is an existing production authorization risk and is not introduced by the dashboard migration.

## Release Decision

This release does not change RLS enablement or alter, remove, or replace any policy. The migration grants `anon` column-level `INSERT` on `submission_id` only, matching the existing column-grant model. It does not grant `SELECT` on `submission_id` or table-level `INSERT`.

Any policy correction requires a separate reviewed release with dedicated insert and regression testing.
