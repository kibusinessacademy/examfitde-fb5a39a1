-- View: next queued step with active lease but no job (>5min stale)
CREATE OR REPLACE VIEW public.ops_next_step_queued_no_job AS
WITH next_queued AS (
  SELECT ps.package_id,
         ps.step_key,
         ps.status::text AS step_status,
         ps.updated_at AS step_updated_at,
         ROW_NUMBER() OVER (PARTITION BY ps.package_id ORDER BY ps.created_at ASC) AS rn
  FROM public.package_steps ps
  WHERE ps.status::text = 'queued'
),
active_jobs AS (
  SELECT DISTINCT payload->>'package_id' AS package_id
  FROM public.job_queue
  WHERE status IN ('pending','processing')
    AND payload ? 'package_id'
)
SELECT nq.package_id,
       cp.title,
       nq.step_key,
       nq.step_status,
       nq.step_updated_at
FROM next_queued nq
JOIN public.course_packages cp ON cp.id = nq.package_id
JOIN public.package_leases pl ON pl.package_id = nq.package_id AND pl.lease_until > now()
LEFT JOIN active_jobs aj ON aj.package_id = nq.package_id::text
WHERE nq.rn = 1
  AND aj.package_id IS NULL
  AND nq.step_updated_at < now() - interval '5 minutes';

NOTIFY pgrst, 'reload schema';