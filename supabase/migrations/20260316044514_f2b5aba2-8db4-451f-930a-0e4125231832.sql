
DROP VIEW IF EXISTS public.v_ops_reentry_misses;

CREATE VIEW public.v_ops_reentry_misses AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  count(*) AS open_steps
FROM public.course_packages cp
JOIN public.package_steps ps
  ON ps.package_id = cp.id
WHERE cp.status = 'queued'
  AND ps.status = 'queued'
  AND NOT EXISTS (
    SELECT 1
    FROM public.job_queue jq
    WHERE jq.package_id = cp.id
      AND jq.status IN ('pending', 'queued', 'processing', 'running', 'batch_pending')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.package_steps ps2
    WHERE ps2.package_id = cp.id
      AND ps2.status = 'blocked'
  )
  AND (
    EXISTS (
      SELECT 1
      FROM public.package_steps ps3
      WHERE ps3.package_id = cp.id
        AND ps3.status IN ('done', 'failed', 'skipped')
    )
    OR EXISTS (
      SELECT 1
      FROM public.job_queue jq2
      WHERE jq2.package_id = cp.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.auto_heal_log ah
      WHERE ah.target_type = 'course_package'
        AND ah.target_id = cp.id::text
    )
  )
GROUP BY cp.id, cp.title, cp.status
