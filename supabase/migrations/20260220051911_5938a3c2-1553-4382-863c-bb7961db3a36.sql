
-- Drop existing views to allow column type changes
drop view if exists public.ops_processing_stale cascade;
drop view if exists public.ops_batch_requeue_summary cascade;
drop view if exists public.ops_prereq_guard_cancelled cascade;
drop view if exists public.ops_step_job_drift cascade;

-- 1) Processing stale (locks older than 15 min)
create or replace view public.ops_processing_stale as
select
  count(*)::int as processing_stale
from public.job_queue
where status = 'processing'
  and locked_at is not null
  and locked_at < now() - interval '15 minutes';

-- 2) Batch-requeue summary
create or replace view public.ops_batch_requeue_summary as
select
  job_type,
  count(*)::int as requeues,
  count(distinct batch_cursor)::int as distinct_cursors,
  count(*) filter (where batch_cursor is null)::int as cursor_null,
  min(updated_at) as first_seen,
  max(updated_at) as last_seen
from public.job_queue
where updated_at > now() - interval '6 hours'
  and status = 'pending'
  and (
    error ilike '%batch%'
    or batch_cursor is not null
  )
group by job_type
order by requeues desc;

-- 3) Prereq-guard cancelled
create or replace view public.ops_prereq_guard_cancelled as
select
  job_type,
  count(*)::int as cancelled,
  min(updated_at) as first_seen,
  max(updated_at) as last_seen,
  max(error) as sample_error
from public.job_queue
where updated_at > now() - interval '6 hours'
  and status = 'cancelled'
  and error ilike '%Prereq guard%'
group by job_type
order by cancelled desc;

-- 4) Step-Job drift (Enum-safe)
create or replace view public.ops_step_job_drift as
select
  ps.package_id,
  ps.step_key,
  ps.status::text as step_status,
  ps.job_id,
  jq.status as job_status,
  jq.updated_at as job_updated_at,
  jq.error as job_error,
  ps.updated_at as step_updated_at,
  case
    when ps.job_id is null and ps.status::text in ('running','enqueued','queued','processing')
      then 'MISSING_JOB'
    when jq.status in ('completed','failed','cancelled')
         and ps.status::text in ('running','enqueued','queued','processing')
      then 'JOB_DONE_STEP_STUCK'
    when jq.status = 'processing'
         and jq.locked_at is not null
         and jq.locked_at < now() - interval '15 minutes'
      then 'JOB_PROCESSING_STALE_LOCK'
    else 'OK'
  end as drift_type
from public.package_steps ps
left join public.job_queue jq on jq.id = ps.job_id
where ps.status::text not in ('done','skipped','blocked','completed');
