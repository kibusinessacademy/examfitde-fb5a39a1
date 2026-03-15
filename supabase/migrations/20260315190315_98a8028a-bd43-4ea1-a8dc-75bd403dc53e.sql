
-- Recovery Health View
create or replace view public.v_ops_batch_recovery_health as
with
batch_stats as (
  select
    count(*) filter (where status = 'validating' and created_at > now() - interval '24 hours') as validating_batches_24h,
    count(*) filter (where status = 'completed'  and created_at > now() - interval '24 hours') as completed_batches_24h,
    count(*) filter (where status = 'failed'     and created_at > now() - interval '24 hours') as failed_batches_24h,
    count(*) filter (where status = 'validating' and created_at > now() - interval '90 minutes') as validating_batches_90m,
    count(*) filter (where status = 'completed'  and created_at > now() - interval '90 minutes') as completed_batches_90m
  from public.llm_batches
),
poll_stats as (
  select
    count(*) filter (where created_at > now() - interval '6 hours' and last_polled_at is not null) as polled_batches_6h,
    count(*) filter (where created_at > now() - interval '6 hours' and results_imported_at is not null) as results_imported_6h,
    count(*) filter (where created_at > now() - interval '6 hours' and domain_import_completed_at is not null) as domain_import_completed_6h,
    max(last_polled_at) as latest_poll_at
  from public.llm_batches
),
request_stats as (
  select
    count(*) filter (where created_at > now() - interval '24 hours' and status = 'completed' and domain_imported_at is null) as import_pending_requests_24h,
    count(*) filter (where created_at > now() - interval '90 minutes' and status = 'completed' and domain_imported_at is not null) as domain_imported_requests_90m
  from public.llm_batch_requests
),
write_stats as (
  select
    (select count(*) from public.content_versions where created_at > now() - interval '90 minutes') as content_versions_90m,
    (select count(*) from public.exam_questions where created_at > now() - interval '90 minutes') as exam_questions_90m
),
job_stats as (
  select
    count(*) filter (where job_type = 'lesson_generate_content' and status = 'completed' and completed_at > now() - interval '90 minutes') as lesson_jobs_completed_90m,
    count(*) filter (where status = 'processing' and started_at < now() - interval '30 minutes') as stale_processing_jobs
  from public.job_queue
),
mismatch_stats as (
  select
    count(*) filter (
      where created_at > now() - interval '6 hours'
        and ((provider = 'openai' and model ilike 'claude%') or (error_summary->>'reason' = 'provider_model_mismatch'))
    ) as provider_model_mismatches_6h
  from public.llm_batches
)
select
  now() as checked_at,
  bs.validating_batches_24h,
  bs.completed_batches_24h,
  bs.failed_batches_24h,
  bs.validating_batches_90m,
  bs.completed_batches_90m,
  ps.polled_batches_6h,
  ps.results_imported_6h,
  ps.domain_import_completed_6h,
  ps.latest_poll_at,
  rs.import_pending_requests_24h,
  rs.domain_imported_requests_90m,
  ws.content_versions_90m,
  ws.exam_questions_90m,
  js.lesson_jobs_completed_90m,
  js.stale_processing_jobs,
  ms.provider_model_mismatches_6h,
  case
    when ps.latest_poll_at is null then 'RED'
    when bs.validating_batches_90m > bs.completed_batches_90m and ws.content_versions_90m = 0 and ws.exam_questions_90m = 0 then 'RED'
    when rs.import_pending_requests_24h > 500 then 'YELLOW'
    when ms.provider_model_mismatches_6h > 0 then 'YELLOW'
    when ws.content_versions_90m > 0 or ws.exam_questions_90m > 0 or js.lesson_jobs_completed_90m > 0 then 'GREEN'
    else 'YELLOW'
  end as overall_health,
  case
    when ps.latest_poll_at is null then 'RED'
    else 'GREEN'
  end as polling_health,
  case
    when rs.import_pending_requests_24h > 1000 then 'RED'
    when rs.import_pending_requests_24h > 250 then 'YELLOW'
    else 'GREEN'
  end as import_health,
  case
    when ws.content_versions_90m = 0 and ws.exam_questions_90m = 0 and js.lesson_jobs_completed_90m = 0 then 'RED'
    when ws.content_versions_90m > 0 or ws.exam_questions_90m > 0 or js.lesson_jobs_completed_90m > 0 then 'GREEN'
    else 'YELLOW'
  end as output_health,
  case
    when ms.provider_model_mismatches_6h > 0 then 'RED'
    else 'GREEN'
  end as routing_health,
  case
    when js.stale_processing_jobs > 20 then 'RED'
    when js.stale_processing_jobs > 0 then 'YELLOW'
    else 'GREEN'
  end as queue_health
from batch_stats bs
cross join poll_stats ps
cross join request_stats rs
cross join write_stats ws
cross join job_stats js
cross join mismatch_stats ms;

-- Backlog Detail View
create or replace view public.v_ops_batch_recovery_backlog as
select
  id,
  provider,
  model,
  status,
  created_at,
  last_polled_at,
  results_imported_at,
  domain_import_completed_at,
  error_summary->>'reason' as error_reason
from public.llm_batches
where created_at > now() - interval '24 hours'
  and (
    status in ('validating', 'failed')
    or results_imported_at is null
    or domain_import_completed_at is null
  )
order by created_at desc;
