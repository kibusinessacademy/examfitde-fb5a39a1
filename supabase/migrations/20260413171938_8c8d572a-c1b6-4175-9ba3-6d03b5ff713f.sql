
-- P1-1: Reset phantom council_approved on blocked/archived packages
UPDATE course_packages
SET
  council_approved = false,
  updated_at = now()
WHERE council_approved = true
  AND status IN ('blocked', 'archived')
  AND id NOT IN (SELECT DISTINCT package_id FROM council_sessions);

-- P1-2: Audit View — Phantom-Done Governance Steps
CREATE OR REPLACE VIEW public.ops_phantom_done_governance AS
SELECT
  ps.package_id,
  c.title AS course_title,
  cp.status AS package_status,
  ps.step_key,
  ps.status AS step_status,
  ps.meta->>'ok' AS meta_ok,
  ps.meta->>'gate_passed' AS gate_passed,
  ps.meta->>'finalization_source' AS finalization_source,
  (SELECT count(*) FROM council_sessions cs WHERE cs.package_id = ps.package_id) AS council_session_count,
  ps.updated_at AS step_updated_at
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
JOIN courses c ON c.id = cp.course_id
WHERE ps.step_key IN ('run_integrity_check', 'quality_council', 'auto_publish', 'validate_exam_pool')
  AND ps.status = 'done'
  AND (ps.meta->>'ok' IS NULL OR ps.meta->>'ok' != 'true');

-- P1-3: Audit View — Phantom Council Approvals
CREATE OR REPLACE VIEW public.ops_phantom_council_approvals AS
SELECT
  cp.id AS package_id,
  c.title AS course_title,
  cp.status AS package_status,
  cp.blocked_reason,
  cp.council_approved,
  (SELECT count(*) FROM council_sessions cs WHERE cs.package_id = cp.id) AS session_count,
  cp.updated_at
FROM course_packages cp
JOIN courses c ON c.id = cp.course_id
WHERE cp.council_approved = true
  AND (SELECT count(*) FROM council_sessions cs WHERE cs.package_id = cp.id) = 0;

-- RLS: Restrict audit views to service_role
GRANT SELECT ON public.ops_phantom_done_governance TO service_role;
GRANT SELECT ON public.ops_phantom_council_approvals TO service_role;
