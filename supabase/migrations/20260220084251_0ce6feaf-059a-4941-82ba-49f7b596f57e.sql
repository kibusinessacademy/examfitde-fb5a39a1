
DROP VIEW IF EXISTS public.ops_step_job_drift;

CREATE VIEW public.ops_step_job_drift
WITH (security_invoker = on) AS
SELECT
  ps.package_id,
  ps.step_key,
  ps.status::text        AS step_status,
  ps.job_id,
  jq.status::text        AS job_status,
  jq.error               AS job_error,
  jq.updated_at          AS job_updated_at,
  ps.updated_at          AS step_updated_at,
  CASE
    WHEN ps.job_id IS NULL
     AND ps.status::text IN ('enqueued','running')
      THEN 'MISSING_JOB'
    WHEN ps.job_id IS NOT NULL
     AND jq.status::text IN ('completed','failed','cancelled')
     AND ps.status::text IN ('enqueued','running')
      THEN 'JOB_DONE_STEP_STUCK'
    ELSE 'OK'
  END AS drift_type
FROM public.package_steps ps
LEFT JOIN public.job_queue jq ON jq.id = ps.job_id
WHERE ps.status::text NOT IN ('done','skipped','blocked');

NOTIFY pgrst, 'reload schema';
