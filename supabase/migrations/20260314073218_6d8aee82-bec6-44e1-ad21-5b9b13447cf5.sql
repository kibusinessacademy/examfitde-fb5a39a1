-- HEAL: Break infinite re-seed loop for Verkäufer + systemwide
-- Root cause: tier1_failed/needs_revision questions never get fixed by re-seed,
-- causing infinite validate→reseed→validate loops.

-- 1. Reject terminal questions for Verkäufer (59b6e214)
UPDATE exam_questions
SET qc_status = 'rejected', status = 'rejected'
WHERE curriculum_id = (
  SELECT curriculum_id FROM course_packages 
  WHERE id = '59b6e214-e181-4c2b-986e-1ce544984d04'
)
AND qc_status IN ('tier1_failed', 'needs_revision');

-- 2. Reset validate_exam_pool (clear re-seed wait)
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    job_id = NULL,
    runner_id = NULL,
    started_at = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"heal_cycles": 0, "reseed_loop_fixed": true, "fixed_at": "2026-03-14T08:00:00Z"}'::jsonb
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
AND step_key = 'validate_exam_pool';

-- 3. Reset generate_exam_pool heal_cycles
UPDATE package_steps
SET meta = COALESCE(meta, '{}'::jsonb) || '{"heal_cycles": 0, "reseed_loop_fixed": true}'::jsonb
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
AND step_key = 'generate_exam_pool';

-- 4. Cancel stale pending validate job
UPDATE job_queue
SET status = 'cancelled', last_error = 'Cancelled: reseed loop fix applied'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
AND job_type = 'package_validate_exam_pool'
AND status = 'pending';

-- 5. SYSTEMWIDE: Reject terminal questions for all active packages with sufficient pools
UPDATE exam_questions eq
SET qc_status = 'rejected', status = 'rejected'
FROM course_packages cp
WHERE eq.curriculum_id = cp.curriculum_id
AND cp.status IN ('building', 'queued')
AND eq.qc_status IN ('tier1_failed', 'needs_revision')
AND (
  SELECT count(*) FROM exam_questions eq2
  WHERE eq2.curriculum_id = eq.curriculum_id
  AND eq2.qc_status = 'approved'
) >= 500;

-- 6. SYSTEMWIDE: Reset heal_cycles for packages stuck in re-seed loops
UPDATE package_steps
SET meta = COALESCE(meta, '{}'::jsonb) || '{"heal_cycles": 0, "reseed_loop_fixed": true}'::jsonb
WHERE step_key IN ('generate_exam_pool', 'validate_exam_pool')
AND (meta->>'heal_cycles')::int >= 3
AND package_id IN (SELECT id FROM course_packages WHERE status IN ('building', 'queued'));