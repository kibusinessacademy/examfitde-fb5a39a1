
-- ═══════════════════════════════════════════════════════════════
-- SYSTEMWIDE REPAIR: Silent-Success Exam Pool + Integrity Persistence
-- ═══════════════════════════════════════════════════════════════

-- 1. Reset phantom-completed exam_pool jobs for packages with 0 non-rejected questions
-- These jobs reported "completed" but produced zero output
UPDATE job_queue
SET 
  status = 'cancelled',
  last_error = COALESCE(last_error, '') || ' | PHANTOM_COMPLETED: zero output detected in cross-package audit',
  meta = COALESCE(meta, '{}'::jsonb) || '{"phantom_completion_detected": true, "audit_cancelled_at": "2026-03-20"}'::jsonb,
  updated_at = now()
WHERE job_type = 'package_generate_exam_pool'
  AND status = 'completed'
  AND package_id IN (
    SELECT cp.id FROM course_packages cp
    WHERE cp.status IN ('building', 'blocked', 'quality_gate_failed')
      AND NOT EXISTS (
        SELECT 1 FROM exam_questions eq
        WHERE eq.curriculum_id = cp.curriculum_id
          AND eq.status != 'rejected'
      )
  );

-- 2. Clear orphaned integrity_report_version where report body is NULL
-- The new trigger prevents future occurrences; this cleans existing violations
UPDATE course_packages
SET 
  integrity_report_version = NULL,
  integrity_passed = false,
  updated_at = now()
WHERE integrity_report_version IS NOT NULL
  AND integrity_report IS NULL;

-- 3. Re-enqueue fresh blueprint seeding for all 9 affected packages
-- (blueprints must exist before exam pool can generate questions)
INSERT INTO job_queue (job_type, package_id, payload, priority, max_attempts, status, run_after)
SELECT 
  'package_auto_seed_exam_blueprints',
  cp.id,
  jsonb_build_object(
    'package_id', cp.id,
    'course_id', cp.course_id,
    'curriculum_id', cp.curriculum_id
  ),
  12, 5, 'pending',
  now() + interval '1 minute'
FROM course_packages cp
WHERE cp.status = 'building'
  AND NOT EXISTS (
    SELECT 1 FROM exam_questions eq
    WHERE eq.curriculum_id = cp.curriculum_id
      AND eq.status != 'rejected'
  )
  AND NOT EXISTS (
    SELECT 1 FROM job_queue jq 
    WHERE jq.package_id = cp.id 
    AND jq.job_type = 'package_auto_seed_exam_blueprints'
    AND jq.status IN ('pending', 'processing')
  );

-- 4. Re-enqueue fresh exam pool generation for all 9 affected packages
-- (staggered 5 min after blueprints)
INSERT INTO job_queue (job_type, package_id, payload, priority, max_attempts, status, run_after)
SELECT 
  'package_generate_exam_pool',
  cp.id,
  jsonb_build_object(
    'package_id', cp.id,
    'course_id', cp.course_id,
    'curriculum_id', cp.curriculum_id
  ),
  12, 5, 'pending',
  now() + interval '6 minutes'
FROM course_packages cp
WHERE cp.status = 'building'
  AND NOT EXISTS (
    SELECT 1 FROM exam_questions eq
    WHERE eq.curriculum_id = cp.curriculum_id
      AND eq.status != 'rejected'
  )
  AND NOT EXISTS (
    SELECT 1 FROM job_queue jq 
    WHERE jq.package_id = cp.id 
    AND jq.job_type = 'package_generate_exam_pool'
    AND jq.status IN ('pending', 'processing')
  );
