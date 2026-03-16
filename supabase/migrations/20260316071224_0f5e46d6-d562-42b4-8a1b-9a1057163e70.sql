
-- ============================================================
-- OPS PIPELINE MAP
-- Control-Tower-View für Queue / Waves / Pipeline-Zustände
-- ============================================================

create or replace view public.ops_pipeline_map as
with package_jobs as (
  select
    cp.id as package_id,
    cp.title,
    cp.status as package_status,
    cp.priority,
    cp.updated_at,
    cp.created_at,
    cp.curriculum_id,
    cu.beruf_id,
    cu.title as curriculum_title,

    case
      when cp.priority = 1 then 'W0 Critical'
      when cp.priority = 2 then 'W1 Active Build'
      when cp.priority between 3 and 4 then 'W2 Follow-up'
      when cp.priority between 5 and 6 then 'W3 Recovery'
      when cp.priority between 7 and 99 then 'Backlog'
      else 'Default / Wrong Priority'
    end as wave_label,

    case
      when cp.priority = 1 then 0
      when cp.priority = 2 then 1
      when cp.priority between 3 and 4 then 2
      when cp.priority between 5 and 6 then 3
      when cp.priority between 7 and 99 then 4
      else 9
    end as wave_order

  from public.course_packages cp
  left join public.curricula cu on cu.id = cp.curriculum_id
  where cp.status not in ('archived', 'cancelled')
),
job_stats as (
  select
    jq.package_id,
    count(*) filter (where jq.status = 'pending') as jobs_pending,
    count(*) filter (where jq.status = 'processing') as jobs_processing,
    count(*) filter (where jq.status = 'completed') as jobs_completed,
    count(*) filter (where jq.status = 'failed') as jobs_failed,
    count(*) filter (where jq.status = 'cancelled') as jobs_cancelled,

    max(jq.started_at) as last_started_at,
    max(jq.completed_at) as last_completed_at,
    max(jq.updated_at) as last_job_update_at,

    string_agg(distinct jq.job_type, ', ' order by jq.job_type) as job_types
  from public.job_queue jq
  where jq.package_id is not null
  group by jq.package_id
),
active_locks as (
  select
    jq.package_id,
    count(*) filter (
      where jq.locked_at is not null
        and jq.status = 'processing'
    ) as locked_jobs,
    max(jq.locked_at) as last_locked_at,
    string_agg(distinct jq.locked_by, ', ' order by jq.locked_by) as locked_by
  from public.job_queue jq
  where jq.package_id is not null
  group by jq.package_id
)
select
  p.package_id,
  p.title,
  p.curriculum_id,
  p.curriculum_title,
  p.beruf_id,

  p.package_status,
  p.priority,
  p.wave_label,
  p.wave_order,

  p.created_at,
  p.updated_at,

  coalesce(js.jobs_pending, 0)::int as jobs_pending,
  coalesce(js.jobs_processing, 0)::int as jobs_processing,
  coalesce(js.jobs_completed, 0)::int as jobs_completed,
  coalesce(js.jobs_failed, 0)::int as jobs_failed,
  coalesce(js.jobs_cancelled, 0)::int as jobs_cancelled,
  coalesce(al.locked_jobs, 0)::int as locked_jobs,

  js.last_started_at,
  js.last_completed_at,
  js.last_job_update_at,
  al.last_locked_at,
  al.locked_by,
  js.job_types,

  case
    when p.package_status = 'blocked' then 'BLOCKED'
    when p.package_status = 'building' and coalesce(js.jobs_processing, 0) = 0 then 'BUILDING_WITHOUT_ACTIVE_JOB'
    when p.package_status = 'queued' and coalesce(js.jobs_pending, 0) = 0 then 'QUEUED_WITHOUT_PENDING_JOB'
    when coalesce(js.jobs_failed, 0) > 0 then 'HAS_FAILURES'
    when coalesce(al.locked_jobs, 0) > 0 then 'RUNNING'
    when coalesce(js.jobs_pending, 0) > 0 then 'READY'
    else 'IDLE'
  end as pipeline_state

from package_jobs p
left join job_stats js on js.package_id = p.package_id
left join active_locks al on al.package_id = p.package_id;

comment on view public.ops_pipeline_map is
'Control tower view for package pipeline waves, queue state, locks and execution health.';
