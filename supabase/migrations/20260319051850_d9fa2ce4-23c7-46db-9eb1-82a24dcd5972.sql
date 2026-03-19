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
    WHEN ((jq.status = ANY (ARRAY['processing'::text, 'running'::text, 'batch_pending'::text])) AND (jq.started_at < (now() - '00:15:00'::interval))) THEN 'zombie'::text
    WHEN ((jq.status = ANY (ARRAY['processing'::text, 'running'::text, 'batch_pending'::text])) AND (jq.locked_at < (now() - '00:10:00'::interval))) THEN 'stale_lock'::text
    WHEN ((jq.status = 'failed'::text) AND (jq.attempts >= jq.max_attempts)) THEN 'exhausted'::text
    WHEN ((jq.status = ANY (ARRAY['pending'::text, 'queued'::text])) AND (jq.created_at < (now() - '02:00:00'::interval))) THEN 'aging'::text
    ELSE 'ok'::text
  END AS health_signal,
  (EXTRACT(epoch FROM (now() - jq.created_at)) / (60)::numeric) AS age_minutes
FROM public.job_queue jq
LEFT JOIN public.course_packages cp ON cp.id = jq.package_id
WHERE (jq.status = ANY (ARRAY['pending'::text, 'queued'::text, 'processing'::text, 'running'::text, 'batch_pending'::text, 'failed'::text]))
ORDER BY
  CASE jq.status
    WHEN 'failed'::text THEN 1
    WHEN 'processing'::text THEN 2
    WHEN 'running'::text THEN 3
    WHEN 'batch_pending'::text THEN 4
    WHEN 'pending'::text THEN 5
    WHEN 'queued'::text THEN 6
    ELSE 99
  END,
  jq.priority,
  jq.created_at;