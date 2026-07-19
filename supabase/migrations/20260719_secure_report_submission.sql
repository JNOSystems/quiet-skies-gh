-- Secure community-report submission path.
-- Apply only after confirming direct anon/authenticated INSERT is revoked.
-- The circuit breaker starts disabled and must remain disabled until the
-- Netlify Function and production verification steps are complete.
--
-- This migration does not read, modify, expose, migrate, or delete incident data.

begin;

-- Fail closed if a browser-facing role can still insert directly.
do $$
begin
  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'reports'
      and grantee in ('anon', 'authenticated')
      and privilege_type = 'INSERT'
  ) or exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'reports'
      and grantee in ('anon', 'authenticated')
      and privilege_type = 'INSERT'
  ) then
    raise exception 'Direct report INSERT must be revoked from anon and authenticated before this migration';
  end if;
end
$$;

-- The idempotency column and partial unique index were deployed in the prior
-- dashboard release. Refuse to install the secure path over an unexpected
-- schema instead of silently weakening duplicate protection.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'reports'
      and column_name = 'submission_id'
      and udt_name = 'uuid'
      and is_nullable = 'YES'
  ) then
    raise exception 'public.reports.submission_id must be a nullable uuid';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_record
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_record.indexrelid
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_record.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where table_namespace.nspname = 'public'
      and table_relation.relname = 'reports'
      and index_relation.relname = 'reports_submission_id_unique'
      and index_record.indisunique
      and index_record.indpred is not null
      and pg_catalog.pg_get_expr(
        index_record.indpred,
        index_record.indrelid
      ) like '%submission_id IS NOT NULL%'
  ) then
    raise exception 'reports_submission_id_unique must be a partial unique index';
  end if;
end
$$;

create schema if not exists qsgh_private;
revoke all on schema qsgh_private from public, anon, authenticated;

create table if not exists qsgh_private.report_submission_settings (
  singleton boolean primary key default true check (singleton),
  submissions_enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);

insert into qsgh_private.report_submission_settings (singleton, submissions_enabled)
values (true, false)
on conflict (singleton) do nothing;

create table if not exists qsgh_private.report_rate_events (
  submission_id uuid primary key,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null
);

create index if not exists report_rate_events_source_time_idx
on qsgh_private.report_rate_events (source_hash, accepted_at desc);

create index if not exists report_rate_events_time_idx
on qsgh_private.report_rate_events (accepted_at desc);

revoke all on all tables in schema qsgh_private from public, anon, authenticated;
revoke all on all sequences in schema qsgh_private from public, anon, authenticated;

create or replace function public.submit_community_report(
  p_zone text,
  p_submission_id uuid,
  p_source_hash text
)
returns table (
  result text,
  report_id bigint,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_now timestamptz;
  v_report_id bigint;
  v_report_created_at timestamptz;
begin
  if p_zone not in (
    'Granada Hills North',
    'Granada Hills Central',
    'Granada Hills South'
  ) then
    raise exception using
      errcode = '22023',
      message = 'invalid_zone';
  end if;

  if p_submission_id is null then
    raise exception using
      errcode = '22023',
      message = 'invalid_submission_id';
  end if;

  if p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'invalid_source_hash';
  end if;

  -- Every caller acquires the locks in this order. The global lock makes the
  -- global-per-minute check atomic; the source lock documents source isolation.
  perform pg_catalog.pg_advisory_xact_lock(20260719, 1);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_source_hash, 20260719)
  );
  v_now := pg_catalog.clock_timestamp();

  if not coalesce((
    select settings.submissions_enabled
    from qsgh_private.report_submission_settings settings
    where settings.singleton = true
  ), false) then
    return query select 'disabled'::text, null::bigint, null::timestamptz;
    return;
  end if;

  select reports.id, reports.created_at
  into v_report_id, v_report_created_at
  from public.reports reports
  where reports.submission_id = p_submission_id;

  if found then
    return query select 'duplicate'::text, v_report_id, v_report_created_at;
    return;
  end if;

  delete from qsgh_private.report_rate_events events
  where events.accepted_at < v_now - interval '2 hours';

  if exists (
    select 1
    from qsgh_private.report_rate_events events
    where events.source_hash = p_source_hash
      and events.accepted_at >= v_now - interval '30 seconds'
  ) then
    return query select 'cooldown'::text, null::bigint, null::timestamptz;
    return;
  end if;

  if (
    select count(*)
    from qsgh_private.report_rate_events events
    where events.source_hash = p_source_hash
      and events.accepted_at >= v_now - interval '10 minutes'
  ) >= 20 then
    return query select 'source_10m_limit'::text, null::bigint, null::timestamptz;
    return;
  end if;

  if (
    select count(*)
    from qsgh_private.report_rate_events events
    where events.source_hash = p_source_hash
      and events.accepted_at >= v_now - interval '1 hour'
  ) >= 60 then
    return query select 'source_hour_limit'::text, null::bigint, null::timestamptz;
    return;
  end if;

  if (
    select count(*)
    from qsgh_private.report_rate_events events
    where events.accepted_at >= v_now - interval '1 minute'
  ) >= 30 then
    return query select 'global_minute_limit'::text, null::bigint, null::timestamptz;
    return;
  end if;

  insert into public.reports (
    zone,
    reported_at,
    submission_id,
    created_at
  )
  values (
    p_zone,
    pg_catalog.to_char(
      v_now at time zone 'America/Los_Angeles',
      'HH12:MI AM'
    ),
    p_submission_id,
    v_now
  )
  on conflict (submission_id) where submission_id is not null
  do nothing
  returning id, created_at
  into v_report_id, v_report_created_at;

  if not found then
    select reports.id, reports.created_at
    into v_report_id, v_report_created_at
    from public.reports reports
    where reports.submission_id = p_submission_id;

    return query select 'duplicate'::text, v_report_id, v_report_created_at;
    return;
  end if;

  insert into qsgh_private.report_rate_events (
    submission_id,
    source_hash,
    accepted_at
  )
  values (
    p_submission_id,
    p_source_hash,
    v_report_created_at
  );

  return query select 'accepted'::text, v_report_id, v_report_created_at;
end
$function$;

revoke execute on function public.submit_community_report(text, uuid, text)
from public, anon, authenticated;

grant execute on function public.submit_community_report(text, uuid, text)
to service_role;

comment on function public.submit_community_report(text, uuid, text) is
'Atomic, service-role-only community report submission with idempotency and abuse limits.';

comment on table qsgh_private.report_rate_events is
'Short-lived HMAC source hashes used only for submission abuse controls; raw IP addresses are never stored.';

commit;

-- Verification SQL (run after migration)
-- --------------------------------------
-- select n.nspname, n.nspacl
-- from pg_namespace n
-- where n.nspname = 'qsgh_private';
--
-- select table_schema, table_name, grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'qsgh_private'
--   and grantee in ('PUBLIC', 'anon', 'authenticated')
-- order by table_name, grantee, privilege_type;
--
-- select routine_schema, routine_name, security_type
-- from information_schema.routines
-- where routine_schema = 'public'
--   and routine_name = 'submit_community_report';
--
-- select
--   has_function_privilege(
--     'service_role',
--     'public.submit_community_report(text,uuid,text)',
--     'EXECUTE'
--   ) as service_role_can_execute,
--   has_function_privilege(
--     'anon',
--     'public.submit_community_report(text,uuid,text)',
--     'EXECUTE'
--   ) as anon_can_execute,
--   has_function_privilege(
--     'authenticated',
--     'public.submit_community_report(text,uuid,text)',
--     'EXECUTE'
--   ) as authenticated_can_execute;
--
-- select
--   has_table_privilege('anon', 'public.reports', 'INSERT')
--     as anon_table_insert,
--   has_any_column_privilege('anon', 'public.reports', 'INSERT')
--     as anon_column_insert,
--   has_table_privilege('authenticated', 'public.reports', 'INSERT')
--     as authenticated_table_insert,
--   has_any_column_privilege('authenticated', 'public.reports', 'INSERT')
--     as authenticated_column_insert;
--
-- select singleton, submissions_enabled, updated_at
-- from qsgh_private.report_submission_settings;
--
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename = 'reports'
--   and indexname = 'reports_submission_id_unique';
--
-- select count(*) as reports_after_migration
-- from public.reports;
--
-- select policyname, permissive, roles, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'reports'
-- order by policyname;
--
-- Enable only at the production release stop point:
-- update qsgh_private.report_submission_settings
-- set submissions_enabled = true,
--     updated_at = clock_timestamp()
-- where singleton = true;

-- Emergency pause
-- ---------------
-- update qsgh_private.report_submission_settings
-- set submissions_enabled = false,
--     updated_at = clock_timestamp()
-- where singleton = true;

-- Rollback
-- --------
-- Roll back only after SUBMISSIONS_ENABLED=false in Netlify and after frontend
-- code no longer calls /api/report. This rollback removes only security-path
-- objects and short-lived rate-limit data. It does not delete complaint rows.
--
-- begin;
-- revoke execute on function public.submit_community_report(text, uuid, text)
--   from service_role;
-- drop function if exists public.submit_community_report(text, uuid, text);
-- drop table if exists qsgh_private.report_rate_events;
-- drop table if exists qsgh_private.report_submission_settings;
-- drop schema if exists qsgh_private;
-- commit;
