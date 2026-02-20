-- Ops Monitoring Views for Pipeline Health

-- 1) Processing jobs without lock (must always be 0)
CREATE OR REPLACE VIEW public.ops_processing_unlocked AS
SELECT count(*) AS processing_unlocked
FROM public.job_queue
WHERE status = 'processing' AND locked_at IS NULL;

-- 2) Stale processing jobs (locked > 15 minutes ago)
CREATE OR REPLACE VIEW public.ops_processing_stale AS
SELECT count(*) AS processing_stale
FROM public.job_queue
WHERE status = 'processing' AND locked_at < now() - interval '15 minutes';

-- 3) Batch cursor stuck (same cursor requeued >= 20 times in 2h)
CREATE OR REPLACE VIEW public.ops_batch_cursor_stuck AS
SELECT
  job_type,
  batch_cursor,
  count(*) AS requeues_last_2h
FROM public.job_queue
WHERE updated_at > now() - interval '2 hours'
  AND status = 'pending'
  AND batch_cursor IS NOT NULL
GROUP BY job_type, batch_cursor
HAVING count(*) >= 20
ORDER BY requeues_last_2h DESC;

-- 4) Step-Job Drift detection view
CREATE OR REPLACE VIEW public.ops_step_job_drift AS
SELECT
  ps.package_id,
  ps.step_key,
  ps.status::text AS step_status,
  ps.job_id,
  jq.status AS job_status,
  jq.updated_at AS job_updated_at,
  ps.updated_at AS step_updated_at,
  CASE
    WHEN ps.job_id IS NULL AND ps.status IN ('running'::step_status) THEN 'MISSING_JOB'
    WHEN jq.status IN ('completed','failed','cancelled') AND ps.status IN ('running'::step_status, 'enqueued'::step_status) THEN 'JOB_DONE_STEP_STUCK'
    ELSE 'OK'
  END AS drift_type
FROM public.package_steps ps
LEFT JOIN public.job_queue jq ON jq.id = ps.job_id
WHERE ps.status NOT IN ('done'::step_status, 'skipped'::step_status, 'blocked'::step_status);