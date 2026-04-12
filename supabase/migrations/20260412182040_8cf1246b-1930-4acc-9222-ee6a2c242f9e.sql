
CREATE OR REPLACE VIEW ops_validate_before_generate_drift AS
SELECT
  cp.id AS package_id,
  c.title AS course_title,
  cp.status AS pkg_status,
  cp.track,
  vep.status AS validate_status,
  vep.meta->>'guard_state' AS validate_guard_state,
  gep.status AS generate_status,
  vep.updated_at AS validate_updated_at,
  gep.updated_at AS generate_updated_at
FROM course_packages cp
JOIN courses c ON c.id = cp.course_id
JOIN package_steps vep ON vep.package_id = cp.id AND vep.step_key = 'validate_exam_pool'
JOIN package_steps gep ON gep.package_id = cp.id AND gep.step_key = 'generate_exam_pool'
WHERE vep.status IN ('failed', 'running')
  AND gep.status NOT IN ('done', 'skipped');
