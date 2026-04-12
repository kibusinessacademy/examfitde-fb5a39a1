
CREATE OR REPLACE VIEW public.ops_integrity_gate_drift AS

-- Case 1: integrity_passed=true but step meta.ok is not true (and meta exists)
SELECT 'integrity_passed_without_meta_ok'::text AS drift_type,
       cp.id AS package_id, cp.title, cp.status AS pkg_status, cp.integrity_passed,
       ps.status::text AS step_status, ps.meta->>'ok' AS meta_ok,
       (ps.meta->>'score') AS meta_score,
       ps.meta->'hard_fail_reasons' AS hard_fail_reasons
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'run_integrity_check'
WHERE cp.integrity_passed = true
  AND (ps.meta->>'ok')::text IS DISTINCT FROM 'true'
  AND ps.meta IS NOT NULL
  AND ps.meta != '{}'::jsonb
  AND ps.meta->>'executed' IS NOT NULL  -- only post-fix packages

UNION ALL

-- Case 2: meta.ok=true but integrity_passed != true
SELECT 'meta_ok_without_integrity_passed',
       cp.id, cp.title, cp.status, cp.integrity_passed,
       ps.status::text, ps.meta->>'ok',
       ps.meta->>'score',
       ps.meta->'hard_fail_reasons'
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'run_integrity_check'
WHERE (ps.meta->>'ok')::text = 'true'
  AND cp.integrity_passed IS DISTINCT FROM true

UNION ALL

-- Case 3: hard_fail_reasons present but meta.ok=true
SELECT 'hard_fails_with_meta_ok',
       cp.id, cp.title, cp.status, cp.integrity_passed,
       ps.status::text, ps.meta->>'ok',
       ps.meta->>'score',
       ps.meta->'hard_fail_reasons'
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'run_integrity_check'
WHERE (ps.meta->>'ok')::text = 'true'
  AND jsonb_typeof(ps.meta->'hard_fail_reasons') = 'array'
  AND jsonb_array_length(ps.meta->'hard_fail_reasons') > 0

UNION ALL

-- Case 4: score < 85 but meta.ok=true
SELECT 'low_score_with_meta_ok',
       cp.id, cp.title, cp.status, cp.integrity_passed,
       ps.status::text, ps.meta->>'ok',
       ps.meta->>'score',
       ps.meta->'hard_fail_reasons'
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'run_integrity_check'
WHERE (ps.meta->>'ok')::text = 'true'
  AND (ps.meta->>'score')::numeric < 85;
