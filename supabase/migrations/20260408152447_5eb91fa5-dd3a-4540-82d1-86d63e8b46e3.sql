
DROP VIEW IF EXISTS public.ops_batch_complete_drift;
CREATE VIEW public.ops_batch_complete_drift AS
SELECT
  ps.package_id,
  ps.step_key,
  ps.status,
  ps.updated_at,
  ps.started_at,
  (ps.meta->>'batch_complete')::boolean AS batch_complete,
  (ps.meta->>'ok')::boolean AS meta_ok,
  (ps.meta->>'completion_ratio') AS completion_ratio,
  (ps.meta->>'needs_regen')::int AS needs_regen,
  COALESCE((ps.meta->>'batch_complete')::boolean, false) OR COALESCE((ps.meta->>'ok')::boolean, false) AS has_completion_signal,
  EXTRACT(EPOCH FROM (now() - ps.updated_at)) / 60 AS drift_minutes,
  cp.title AS package_title
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
WHERE ps.status NOT IN ('done', 'skipped')
  AND (
    (ps.meta->>'batch_complete')::boolean = true
    OR (ps.meta->>'ok')::boolean = true
  )
ORDER BY ps.updated_at ASC;
