-- FIX: Exam Question Lifecycle Drift
-- Promote draft + tier1_passed → review for active packages

UPDATE exam_questions eq
SET status = 'review'
FROM course_packages cp
WHERE cp.curriculum_id = eq.curriculum_id
  AND cp.status IN ('building', 'blocked', 'queued')
  AND eq.status = 'draft'
  AND eq.qc_status = 'tier1_passed';

-- Reset validate_exam_pool step for SoVFa
UPDATE package_steps
SET status = 'queued',
    finished_at = NULL,
    last_error = NULL,
    started_at = NULL
WHERE package_id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND step_key = 'validate_exam_pool'
  AND status != 'done';