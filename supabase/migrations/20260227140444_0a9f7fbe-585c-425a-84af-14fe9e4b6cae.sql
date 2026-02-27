CREATE OR REPLACE VIEW pipeline_deadlock_detection AS
SELECT
  ps.package_id,
  cp.curriculum_id,
  count(*) AS total_steps,
  count(*) FILTER (WHERE ps.status = 'blocked') AS blocked_steps,
  count(*) FILTER (WHERE ps.status = 'failed') AS failed_steps,
  count(*) FILTER (WHERE ps.status IN ('done', 'skipped')) AS completed_steps,
  count(*) FILTER (WHERE ps.status IN ('running', 'enqueued', 'queued')) AS active_steps,
  true AS is_deadlocked
FROM package_steps ps
LEFT JOIN course_packages cp ON cp.id = ps.package_id
WHERE cp.status = 'building'
GROUP BY ps.package_id, cp.curriculum_id
HAVING count(*) FILTER (WHERE ps.status IN ('running', 'enqueued', 'queued', 'done', 'skipped')) = 0;