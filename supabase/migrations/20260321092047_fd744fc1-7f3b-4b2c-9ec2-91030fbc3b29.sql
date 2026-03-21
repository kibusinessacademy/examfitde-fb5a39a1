-- Force PostgREST schema cache refresh by recreating the view
DROP VIEW IF EXISTS public.v_admin_queue_ssot;

CREATE VIEW public.v_admin_queue_ssot AS
SELECT
  jq.id AS job_id,
  jq.job_type,
  jq.status AS job_status,
  jq.package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  jq.priority,
  jq.priority AS job_priority,
  jq.attempts,
  jq.max_attempts,
  jq.run_after,
  jq.locked_at,
  jq.locked_by,
  jq.started_at,
  jq.completed_at,
  jq.last_error,
  jq.created_at,
  jq.updated_at,
  jq.meta,
  CASE
    WHEN jq.status IN ('processing', 'running', 'batch_pending') AND jq.started_at < (now() - interval '15 minutes') THEN 'zombie'
    WHEN jq.status IN ('processing', 'running', 'batch_pending') AND jq.locked_at < (now() - interval '10 minutes') THEN 'stale_lock'
    WHEN jq.status = 'failed' AND jq.attempts >= jq.max_attempts THEN 'exhausted'
    WHEN jq.status = 'failed' THEN 'retriable'
    WHEN jq.status IN ('pending', 'queued') AND jq.created_at < (now() - interval '2 hours') THEN 'aging'
    ELSE 'normal'
  END AS health_signal,
  (EXTRACT(epoch FROM (now() - jq.created_at)) / 60) AS age_minutes
FROM public.job_queue jq
LEFT JOIN public.course_packages cp ON cp.id = jq.package_id
WHERE jq.status IN ('pending', 'queued', 'processing', 'running', 'batch_pending', 'failed')
   OR (jq.status = 'completed' AND jq.completed_at > now() - interval '1 hour')
ORDER BY
  CASE jq.status
    WHEN 'failed' THEN 1
    WHEN 'processing' THEN 2
    WHEN 'running' THEN 3
    WHEN 'batch_pending' THEN 4
    WHEN 'pending' THEN 5
    WHEN 'queued' THEN 6
    WHEN 'completed' THEN 7
    ELSE 99
  END,
  jq.priority,
  jq.created_at;

-- Force PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';