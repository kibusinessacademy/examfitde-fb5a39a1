
-- Drop and recreate view to fix column order
DROP VIEW IF EXISTS public.ops_queued_step_without_job;

CREATE VIEW public.ops_queued_step_without_job AS
SELECT
  ps.package_id,
  ps.step_key,
  ps.status AS step_status,
  ps.updated_at AS step_updated_at,
  cp.status AS pkg_status,
  cp.priority AS pkg_priority,
  COALESCE(sjm.job_types[1], 'package_' || ps.step_key) AS expected_job_type,
  EXISTS (
    SELECT 1 FROM job_queue jq
    WHERE jq.package_id = ps.package_id
      AND jq.job_type = COALESCE(sjm.job_types[1], 'package_' || ps.step_key)
      AND jq.status IN ('pending','queued','processing','running','batch_pending')
  ) AS has_active_job,
  NOT EXISTS (
    SELECT 1
    FROM pipeline_dag_edges pde
    WHERE pde.step_key = ps.step_key
      AND NOT EXISTS (
        SELECT 1 FROM package_steps ups
        WHERE ups.package_id = ps.package_id
          AND ups.step_key = pde.depends_on
          AND ups.status IN ('done', 'skipped')
      )
  ) AS dag_ready
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
LEFT JOIN step_job_mapping sjm ON sjm.step_key = ps.step_key
WHERE ps.status = 'queued'
  AND cp.status IN ('building', 'quality_gate_failed');
