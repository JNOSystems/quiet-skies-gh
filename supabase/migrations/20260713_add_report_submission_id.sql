-- Apply before deploying frontend code that sends submission_id.
-- Existing clients remain compatible because the new column is nullable.
-- Production uses column-level INSERT grants for anon, so submission_id
-- requires its own column grant. This migration does not modify RLS policies.

begin;

-- Keep the before/after row-count comparison stable during this short migration.
lock table public.reports in share row exclusive mode;

create temporary table qsgh_reports_migration_snapshot
on commit drop
as
select
  (select count(*) from public.reports) as reports_before,
  (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'reports'
  ) as rls_enabled_before,
  (
    select c.relforcerowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'reports'
  ) as rls_forced_before,
  (
    select coalesce(jsonb_agg(to_jsonb(policy_row) order by policy_row.policyname), '[]'::jsonb)
    from (
      select policyname, permissive, roles, cmd, qual, with_check
      from pg_policies
      where schemaname = 'public' and tablename = 'reports'
    ) as policy_row
  ) as policies_before;

alter table public.reports
add column if not exists submission_id uuid;

create unique index if not exists reports_submission_id_unique
on public.reports (submission_id)
where submission_id is not null;

grant insert (submission_id)
on table public.reports
to anon;

comment on column public.reports.submission_id is
'Random client request UUID used only to prevent duplicate complaint inserts.';

-- Post-migration verification: submission_id is nullable uuid.
select column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'reports'
  and column_name = 'submission_id';

-- Post-migration verification: the unique index remains partial.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'reports'
  and indexname = 'reports_submission_id_unique';

-- Post-migration verification: anon can INSERT but cannot SELECT submission_id.
select
  has_column_privilege('anon', 'public.reports', 'submission_id', 'INSERT')
    as anon_can_insert_submission_id,
  has_column_privilege('anon', 'public.reports', 'submission_id', 'SELECT')
    as anon_can_select_submission_id;

-- Post-migration verification: no table-level privilege was added.
select privilege_type, is_grantable
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema = 'public'
  and table_name = 'reports'
order by privilege_type;

-- Post-migration verification: complaint rows were not deleted or rewritten.
select
  snapshot.reports_before,
  current_state.reports_after,
  snapshot.reports_before = current_state.reports_after as row_count_unchanged
from qsgh_reports_migration_snapshot snapshot
cross join lateral (
  select count(*) as reports_after from public.reports
) current_state;

-- Post-migration verification: RLS enablement and FORCE state are unchanged.
select
  snapshot.rls_enabled_before,
  current_state.rls_enabled_after,
  snapshot.rls_forced_before,
  current_state.rls_forced_after,
  snapshot.rls_enabled_before = current_state.rls_enabled_after
    and snapshot.rls_forced_before = current_state.rls_forced_after
    as rls_unchanged
from qsgh_reports_migration_snapshot snapshot
cross join lateral (
  select c.relrowsecurity as rls_enabled_after,
         c.relforcerowsecurity as rls_forced_after
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'reports'
) current_state;

-- Post-migration verification: every policy definition is unchanged.
select
  snapshot.policies_before,
  current_state.policies_after,
  snapshot.policies_before = current_state.policies_after as policies_unchanged
from qsgh_reports_migration_snapshot snapshot
cross join lateral (
  select coalesce(jsonb_agg(to_jsonb(policy_row) order by policy_row.policyname), '[]'::jsonb)
    as policies_after
  from (
    select policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'reports'
  ) as policy_row
) current_state;

commit;

-- Rollback only after frontend code no longer sends submission_id.
-- Run these statements separately; they are intentionally commented out.
-- revoke insert (submission_id) on table public.reports from anon;
-- drop index if exists public.reports_submission_id_unique;
-- alter table public.reports drop column if exists submission_id;
