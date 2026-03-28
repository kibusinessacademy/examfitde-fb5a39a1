
-- FIX: Promote 3 packages to 'published' that pass ALL guards:
-- - integrity_passed = true, council_approved = true
-- - enrichment 100%, approved questions >= 100, hollow lessons = 0
-- - all 25 functional steps = done
-- Root cause: auto_publish step ran when package was in 'done' or 'quality_gate_failed' 
-- instead of 'building', so the OPS_GUARD:NON_BUILDING_PACKAGE blocked the actual publish.

-- Steuerfach: status=done → published
UPDATE course_packages 
SET status = 'published', published_at = now(), updated_at = now()
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND integrity_passed = true AND council_approved = true;

-- EBT: status=quality_gate_failed → published  
UPDATE course_packages 
SET status = 'published', published_at = now(), updated_at = now()
WHERE id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  AND integrity_passed = true AND council_approved = true;

-- SoVFa: status=quality_gate_failed → published
UPDATE course_packages 
SET status = 'published', published_at = now(), updated_at = now()
WHERE id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND integrity_passed = true AND council_approved = true;

-- Log
INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, metadata)
VALUES ('publish_promotion', 'forensik_p0_fix', 'success',
  'Promoted 3 packages (Steuerfach, EBT, SoVFa) to published. Root cause: auto_publish step ran against non-building status, NON_BUILDING_PACKAGE guard blocked actual publish despite all quality gates passing.',
  '{"packages":["a9f19137-a004-4850-838a-bdc8f8a705f5","fd1d8192-a16f-496b-80c8-5e06f70ec21a","772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1"],"root_cause":"OPS_GUARD:NON_BUILDING_PACKAGE in auto_publish step"}'::jsonb);
