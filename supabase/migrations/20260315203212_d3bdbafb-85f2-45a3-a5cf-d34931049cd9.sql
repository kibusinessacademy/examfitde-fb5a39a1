
-- View: classify failed/cancelled jobs into protected_stop vs real_failure
create or replace view public.v_ops_job_failure_classification as
select
  jq.id,
  jq.job_type,
  jq.package_id,
  jq.status,
  jq.attempts,
  jq.max_attempts,
  jq.created_at,
  jq.started_at,
  jq.completed_at,
  jq.last_error,
  jq.last_error_code,
  jq.result,
  case
    when jq.status not in ('failed', 'cancelled') then 'not_applicable'
    when coalesce(jq.last_error, '') ilike '%STALE_LOCK_RECOVERY%' then 'protected_stop'
    when coalesce(jq.last_error, '') ilike '%Auto-healed%duplicate%job%cancelled%' then 'protected_stop'
    when coalesce(jq.last_error, '') ilike '%OPS_GUARD%NON_BUILDING_PACKAGE%' then 'protected_stop'
    when coalesce(jq.last_error_code, '') in (
      'STALE_LOCK_RECOVERY',
      'DUPLICATE_JOB_CANCELLED',
      'OPS_GUARD_NON_BUILDING_PACKAGE'
    ) then 'protected_stop'
    when coalesce(jq.last_error, '') ilike '%RATE_LIMIT%' then 'real_failure'
    when coalesce(jq.last_error, '') ilike '%TIMEOUT%' then 'real_failure'
    when coalesce(jq.last_error, '') ilike '%JSON%PARSE%' then 'real_failure'
    when coalesce(jq.last_error, '') ilike '%PROVIDER_MODEL_MISMATCH%' then 'real_failure'
    when coalesce(jq.last_error, '') ilike '%LLM_ERROR%' then 'real_failure'
    when coalesce(jq.last_error, '') ilike '%VALIDATION_ERROR%' then 'real_failure'
    when coalesce(jq.last_error_code, '') in (
      'RATE_LIMIT',
      'TIMEOUT',
      'JSON_PARSE_ERROR',
      'PROVIDER_MODEL_MISMATCH',
      'VALIDATION_ERROR',
      'LLM_ERROR'
    ) then 'real_failure'
    else 'unknown_failure'
  end as failure_class,
  case
    when coalesce(jq.last_error, '') ilike '%STALE_LOCK_RECOVERY%' then 'stale_lock_recovery'
    when coalesce(jq.last_error, '') ilike '%Auto-healed%duplicate%job%cancelled%' then 'duplicate_job_cancelled'
    when coalesce(jq.last_error, '') ilike '%OPS_GUARD%NON_BUILDING_PACKAGE%' then 'ops_guard_non_building'
    when coalesce(jq.last_error, '') ilike '%RATE_LIMIT%' then 'rate_limit'
    when coalesce(jq.last_error, '') ilike '%TIMEOUT%' then 'timeout'
    when coalesce(jq.last_error, '') ilike '%JSON%PARSE%' then 'json_parse_error'
    when coalesce(jq.last_error, '') ilike '%PROVIDER_MODEL_MISMATCH%' then 'provider_model_mismatch'
    when coalesce(jq.last_error, '') ilike '%LLM_ERROR%' then 'llm_error'
    when coalesce(jq.last_error, '') ilike '%VALIDATION_ERROR%' then 'validation_error'
    else 'other'
  end as failure_reason
from public.job_queue jq;

comment on view public.v_ops_job_failure_classification is
'Classifies failed/cancelled jobs into protected_stop vs real_failure for Ops dashboards.';

-- Summary view for 24h KPIs
create or replace view public.v_ops_job_failure_summary_24h as
select
  count(*) filter (where status = 'completed' and created_at > now() - interval '24 hours') as completed_24h,
  count(*) filter (
    where created_at > now() - interval '24 hours'
      and status in ('failed', 'cancelled')
      and case
        when coalesce(last_error, '') ilike '%STALE_LOCK_RECOVERY%' then true
        when coalesce(last_error, '') ilike '%Auto-healed%duplicate%job%cancelled%' then true
        when coalesce(last_error, '') ilike '%OPS_GUARD%NON_BUILDING_PACKAGE%' then true
        when coalesce(last_error_code, '') in ('STALE_LOCK_RECOVERY','DUPLICATE_JOB_CANCELLED','OPS_GUARD_NON_BUILDING_PACKAGE') then true
        else false
      end
  ) as protected_stop_24h,
  count(*) filter (
    where created_at > now() - interval '24 hours'
      and status in ('failed', 'cancelled')
      and case
        when coalesce(last_error, '') ilike '%RATE_LIMIT%' then true
        when coalesce(last_error, '') ilike '%TIMEOUT%' then true
        when coalesce(last_error, '') ilike '%JSON%PARSE%' then true
        when coalesce(last_error, '') ilike '%PROVIDER_MODEL_MISMATCH%' then true
        when coalesce(last_error, '') ilike '%LLM_ERROR%' then true
        when coalesce(last_error, '') ilike '%VALIDATION_ERROR%' then true
        when coalesce(last_error_code, '') in ('RATE_LIMIT','TIMEOUT','JSON_PARSE_ERROR','PROVIDER_MODEL_MISMATCH','VALIDATION_ERROR','LLM_ERROR') then true
        else false
      end
  ) as real_failure_24h,
  count(*) filter (
    where created_at > now() - interval '24 hours'
      and status in ('failed', 'cancelled')
      and not case
        when coalesce(last_error, '') ilike '%STALE_LOCK_RECOVERY%' then true
        when coalesce(last_error, '') ilike '%Auto-healed%duplicate%job%cancelled%' then true
        when coalesce(last_error, '') ilike '%OPS_GUARD%NON_BUILDING_PACKAGE%' then true
        when coalesce(last_error_code, '') in ('STALE_LOCK_RECOVERY','DUPLICATE_JOB_CANCELLED','OPS_GUARD_NON_BUILDING_PACKAGE') then true
        else false
      end
      and not case
        when coalesce(last_error, '') ilike '%RATE_LIMIT%' then true
        when coalesce(last_error, '') ilike '%TIMEOUT%' then true
        when coalesce(last_error, '') ilike '%JSON%PARSE%' then true
        when coalesce(last_error, '') ilike '%PROVIDER_MODEL_MISMATCH%' then true
        when coalesce(last_error, '') ilike '%LLM_ERROR%' then true
        when coalesce(last_error, '') ilike '%VALIDATION_ERROR%' then true
        when coalesce(last_error_code, '') in ('RATE_LIMIT','TIMEOUT','JSON_PARSE_ERROR','PROVIDER_MODEL_MISMATCH','VALIDATION_ERROR','LLM_ERROR') then true
        else false
      end
  ) as unknown_failure_24h
from public.job_queue;

comment on view public.v_ops_job_failure_summary_24h is
'24h summary: completed vs protected stops vs real failures vs unknown.';

-- Enqueue dedupe: safe insert function
create or replace function public.enqueue_job_if_absent(
  p_job_type text,
  p_package_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_priority int default 100,
  p_max_attempts int default 5,
  p_run_after timestamptz default now()
)
returns table (
  job_id uuid,
  created boolean,
  deduped boolean,
  existing_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step_key text;
  v_existing record;
  v_new_id uuid;
begin
  v_step_key := coalesce(
    p_payload->>'step_key',
    p_payload->>'step',
    p_payload->>'target_step',
    ''
  );

  select jq.id, jq.status
  into v_existing
  from public.job_queue jq
  where jq.job_type = p_job_type
    and coalesce(jq.package_id::text, '') = coalesce(p_package_id::text, '')
    and coalesce(jq.meta->>'step_key', jq.meta->>'step', jq.meta->>'target_step', '') = v_step_key
    and jq.status in ('pending', 'queued', 'processing', 'running', 'batch_pending')
  order by jq.created_at desc
  limit 1;

  if found then
    return query select v_existing.id, false, true, v_existing.status;
    return;
  end if;

  insert into public.job_queue (
    job_type, package_id, status, priority, max_attempts, run_after, payload, meta, created_at, updated_at
  ) values (
    p_job_type, p_package_id, 'pending', p_priority, p_max_attempts, p_run_after,
    p_payload, p_payload, now(), now()
  )
  returning id into v_new_id;

  return query select v_new_id, true, false, 'pending'::text;
end;
$$;

comment on function public.enqueue_job_if_absent is
'Idempotent job enqueue: returns existing active job if duplicate, otherwise inserts new.';
