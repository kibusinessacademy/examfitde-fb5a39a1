-- REFINED SYSTEMWIDE FIX: OPS_GUARD recovery (corrected - no completed_at column)

-- 1. Reset run_integrity_check steps with explicit OPS_GUARD errors
UPDATE package_steps ps
SET status = 'queued',
    last_error = NULL,
    job_id = NULL,
    runner_id = NULL,
    started_at = NULL,
    attempts = 0
FROM course_packages cp
WHERE ps.package_id = cp.id
  AND cp.status IN ('building', 'quality_gate_failed', 'blocked')
  AND ps.step_key = 'run_integrity_check'
  AND (
    ps.status IN ('failed', 'blocked', 'timeout')
    OR (ps.status IN ('queued', 'enqueued') AND ps.last_error ILIKE '%OPS_GUARD%')
  )
  AND (
    ps.last_error ILIKE '%OPS_GUARD%'
    OR ps.last_error ILIKE '%NON_BUILDING_PACKAGE%'
  );

-- 2. Only reset quality_gate_failed packages with explicit OPS_GUARD cause
UPDATE course_packages cp
SET status = 'building',
    updated_at = now()
WHERE cp.status = 'quality_gate_failed'
  AND EXISTS (
    SELECT 1
    FROM package_steps ps
    WHERE ps.package_id = cp.id
      AND ps.step_key = 'run_integrity_check'
      AND (
        ps.last_error ILIKE '%OPS_GUARD%'
        OR ps.last_error ILIKE '%NON_BUILDING_PACKAGE%'
      )
  );