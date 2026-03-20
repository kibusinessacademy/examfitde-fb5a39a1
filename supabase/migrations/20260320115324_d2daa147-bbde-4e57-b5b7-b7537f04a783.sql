
-- ═══════════════════════════════════════════════════════
-- HEAL MFA (11b697be-07a8-4164-ab1b-a8747ec49b03)
-- Step 1: Reset quality_council and council_review steps to allow re-run
-- Step 2: Reset auto_publish from blocked to queued  
-- Step 3: Reset run_integrity_check to queued for fresh re-evaluation
-- Step 4: Enqueue quality_council job
-- ═══════════════════════════════════════════════════════

-- 1a. Reset quality_council step to 'queued' so it can be re-processed
UPDATE package_steps
SET status = 'queued', last_error = NULL, attempts = 0, updated_at = NOW()
WHERE package_id = '11b697be-07a8-4164-ab1b-a8747ec49b03'
  AND step_key = 'quality_council';

-- 1b. Reset council_review step
UPDATE package_steps
SET status = 'queued', last_error = NULL, attempts = 0, updated_at = NOW()
WHERE package_id = '11b697be-07a8-4164-ab1b-a8747ec49b03'
  AND step_key = 'council_review';

-- 2. Reset run_integrity_check to queued for fresh evaluation after council
UPDATE package_steps
SET status = 'queued', last_error = NULL, attempts = 0, updated_at = NOW()
WHERE package_id = '11b697be-07a8-4164-ab1b-a8747ec49b03'
  AND step_key = 'run_integrity_check';

-- 3. Reset auto_publish from blocked to queued, clear loop guard metadata
UPDATE package_steps
SET status = 'queued', last_error = NULL, attempts = 0, 
    meta = COALESCE(meta, '{}'::jsonb) - 'loop_guard_count' - 'loop_guard_at',
    updated_at = NOW()
WHERE package_id = '11b697be-07a8-4164-ab1b-a8747ec49b03'
  AND step_key = 'auto_publish';

-- 4. Set package status back to building (required for job execution)
UPDATE course_packages
SET status = 'building', blocked_reason = NULL, updated_at = NOW()
WHERE id = '11b697be-07a8-4164-ab1b-a8747ec49b03';

-- 5. Enqueue quality_council job 
INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, max_attempts)
SELECT 
  'package_quality_council',
  '11b697be-07a8-4164-ab1b-a8747ec49b03',
  'pending',
  cp.priority,
  jsonb_build_object('package_id', cp.id, 'course_id', cp.course_id, 'curriculum_id', cp.curriculum_id),
  jsonb_build_object('trigger', 'heal_mfa_council', 'created_at', NOW()::text),
  5
FROM course_packages cp WHERE cp.id = '11b697be-07a8-4164-ab1b-a8747ec49b03'
AND NOT EXISTS (
  SELECT 1 FROM job_queue jq
  WHERE jq.package_id = '11b697be-07a8-4164-ab1b-a8747ec49b03'
    AND jq.job_type = 'package_quality_council'
    AND jq.status IN ('pending', 'queued')
);

-- ═══════════════════════════════════════════════════════
-- HEAL DIGITALISIERUNGSMGMT (eec21a03-75f4-43a3-aabc-f826f7d15159)
-- Root cause resolved: GENERIC_BLUEPRINTS was the QG failure.
-- After 7 re-seed cycles, all 110 blueprints now have valid 
-- canonical_statements (min 26 chars). The validate_blueprints step
-- was set to 'skipped' by escalation breaker after 99 attempts.
-- Fix: Reset validate_blueprints to queued for a clean re-validation.
-- ═══════════════════════════════════════════════════════

-- 6. Reset validate_blueprints from skipped to queued
UPDATE package_steps
SET status = 'queued', last_error = NULL, attempts = 0, 
    meta = COALESCE(meta, '{}'::jsonb) - 'heal_cycles',
    updated_at = NOW()
WHERE package_id = 'eec21a03-75f4-43a3-aabc-f826f7d15159'
  AND step_key = 'validate_blueprints';

-- 7. Reset package from blocked to building, clear kill_switch reason
UPDATE course_packages
SET status = 'building', blocked_reason = NULL, updated_at = NOW()
WHERE id = 'eec21a03-75f4-43a3-aabc-f826f7d15159';

-- 8. Enqueue validate_blueprints job
INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, max_attempts)
SELECT 
  'package_validate_blueprints',
  'eec21a03-75f4-43a3-aabc-f826f7d15159',
  'pending',
  cp.priority,
  jsonb_build_object('package_id', cp.id, 'course_id', cp.course_id, 'curriculum_id', cp.curriculum_id),
  jsonb_build_object('trigger', 'heal_digimgmt_revalidate', 'created_at', NOW()::text),
  5
FROM course_packages cp WHERE cp.id = 'eec21a03-75f4-43a3-aabc-f826f7d15159'
AND NOT EXISTS (
  SELECT 1 FROM job_queue jq
  WHERE jq.package_id = 'eec21a03-75f4-43a3-aabc-f826f7d15159'
    AND jq.job_type = 'package_validate_blueprints'
    AND jq.status IN ('pending', 'queued')
);

-- 9. Cancel any stale cancelled/failed blueprint jobs
UPDATE job_queue
SET status = 'cancelled', last_error = 'cancelled: superseded by heal revalidation'
WHERE package_id = 'eec21a03-75f4-43a3-aabc-f826f7d15159'
  AND job_type IN ('package_validate_blueprints', 'package_auto_seed_exam_blueprints')
  AND status IN ('failed')
  AND id NOT IN (
    SELECT id FROM job_queue 
    WHERE package_id = 'eec21a03-75f4-43a3-aabc-f826f7d15159'
      AND status = 'pending'
  );

-- 10. Audit log
INSERT INTO admin_actions (action, scope, payload)
VALUES (
  'heal_mfa_and_digimgmt',
  'pipeline_recovery',
  jsonb_build_object(
    'mfa_package_id', '11b697be-07a8-4164-ab1b-a8747ec49b03',
    'mfa_action', 'reset quality_council + run_integrity_check + auto_publish → enqueue quality_council job',
    'digimgmt_package_id', 'eec21a03-75f4-43a3-aabc-f826f7d15159',
    'digimgmt_action', 'reset validate_blueprints (was skipped after 99 attempts) → re-validate after re-seed fixed GENERIC_BLUEPRINTS',
    'digimgmt_root_cause', 'GENERIC_BLUEPRINTS: 3 blueprints with <5 char canonical_statement. 7 auto-seed cycles fixed all 110 blueprints (min 26 chars). Escalation breaker set step to skipped before re-validation could pass.'
  )
);
