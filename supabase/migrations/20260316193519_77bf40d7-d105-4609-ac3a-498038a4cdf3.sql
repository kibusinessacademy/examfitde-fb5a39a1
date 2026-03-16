
-- Ops view: auto_publish blockers with recent cancel history
CREATE OR REPLACE VIEW public.v_ops_auto_publish_blockers AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.priority,
  cp.status AS package_status,
  cp.blocked_reason,
  ps.status AS step_status,
  ps.last_error AS step_last_error,
  ps.meta AS step_meta,
  ps.updated_at AS step_updated_at,
  (
    SELECT COUNT(*)
    FROM job_queue jq
    WHERE jq.job_type = 'package_auto_publish'
      AND jq.package_id = cp.id
      AND jq.status = 'cancelled'
      AND jq.completed_at > now() - interval '2 hours'
  ) AS cancelled_count_2h,
  (
    SELECT MAX(jq.completed_at)
    FROM job_queue jq
    WHERE jq.job_type = 'package_auto_publish'
      AND jq.package_id = cp.id
      AND jq.status = 'cancelled'
  ) AS last_cancel_at,
  cp.integrity_passed,
  cp.integrity_report_version_num,
  now() AS checked_at
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'auto_publish'
WHERE ps.status IN ('blocked', 'enqueued', 'queued', 'running')
  AND cp.status IN ('building', 'queued', 'quality_gate_failed');
