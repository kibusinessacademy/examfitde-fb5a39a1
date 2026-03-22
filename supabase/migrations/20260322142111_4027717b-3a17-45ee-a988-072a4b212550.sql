
-- View: ops_integrity_contract_violations
-- Surfaces any package where the integrity invariant is violated:
--   run_integrity_check = done BUT integrity_report IS NULL
-- Also catches persistence_defect failures and stale blocked states.

CREATE OR REPLACE VIEW public.ops_integrity_contract_violations AS

-- Case 1: Step done but report missing (hard invariant violation)
SELECT
  cp.id AS package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  ps.status AS integrity_step_status,
  cp.integrity_passed,
  cp.integrity_report IS NOT NULL AS has_report,
  cp.blocked_reason,
  ps.last_error,
  ps.updated_at AS step_updated_at,
  cp.updated_at AS package_updated_at,
  'REPORT_MISSING_AFTER_DONE' AS violation_type,
  'critical' AS severity
FROM course_packages cp
JOIN package_steps ps
  ON ps.package_id = cp.id
 AND ps.step_key = 'run_integrity_check'
WHERE ps.status = 'done'
  AND cp.integrity_report IS NULL

UNION ALL

-- Case 2: Persistence defect failures
SELECT
  cp.id AS package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  ps.status AS integrity_step_status,
  cp.integrity_passed,
  cp.integrity_report IS NOT NULL AS has_report,
  cp.blocked_reason,
  ps.last_error,
  ps.updated_at AS step_updated_at,
  cp.updated_at AS package_updated_at,
  'PERSISTENCE_DEFECT' AS violation_type,
  'critical' AS severity
FROM course_packages cp
JOIN package_steps ps
  ON ps.package_id = cp.id
 AND ps.step_key = 'run_integrity_check'
WHERE ps.status = 'failed'
  AND ps.meta::text LIKE '%persistence_defect%'

UNION ALL

-- Case 3: Blocked by fail-closed guard
SELECT
  cp.id AS package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  ps.status AS integrity_step_status,
  cp.integrity_passed,
  cp.integrity_report IS NOT NULL AS has_report,
  cp.blocked_reason,
  ps.last_error,
  ps.updated_at AS step_updated_at,
  cp.updated_at AS package_updated_at,
  'BLOCKED_BY_GUARD' AS violation_type,
  'high' AS severity
FROM course_packages cp
JOIN package_steps ps
  ON ps.package_id = cp.id
 AND ps.step_key = 'run_integrity_check'
WHERE cp.blocked_reason = 'INTEGRITY_REPORT_MISSING_AFTER_DONE';

COMMENT ON VIEW public.ops_integrity_contract_violations IS
  'Surfaces integrity invariant violations: report missing after done, persistence defects, fail-closed blocks. Zero rows = healthy.';
