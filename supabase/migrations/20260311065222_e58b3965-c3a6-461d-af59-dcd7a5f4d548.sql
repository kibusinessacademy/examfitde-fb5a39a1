
-- ═══ FIX 1: Verkäufer (59b6e214) ═══
-- Cancel stale failed validate_tutor_index job so runner can create new one
UPDATE job_queue 
SET status = 'cancelled', last_error = 'Forensic fix: race condition - validator ran before builder'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND job_type = 'package_validate_tutor_index'
  AND status = 'failed';

-- Reset validate_tutor_index step cleanly (attempts=0 so runner re-enqueues)
UPDATE package_steps
SET status = 'queued', attempts = 0, last_error = NULL, started_at = NULL, finished_at = NULL
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'validate_tutor_index';

-- Reset generate_lesson_minichecks + validate (they have stale finished_at from old run)
UPDATE package_steps
SET status = 'queued', attempts = 0, last_error = NULL, started_at = NULL, finished_at = NULL
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key IN ('generate_lesson_minichecks', 'validate_lesson_minichecks');

-- Clear last_error on package
UPDATE course_packages 
SET last_error = NULL 
WHERE id = '59b6e214-e181-4c2b-986e-1ce544984d04';

-- ═══ FIX 2: Büromanagement (5377ab93) ═══
-- Reset generate_exam_pool to queued (HOLLOW: 0 questions despite step=done)
UPDATE package_steps
SET status = 'queued', attempts = 0, last_error = NULL, started_at = NULL, finished_at = NULL
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND step_key IN ('generate_exam_pool', 'validate_exam_pool');

-- Cancel stuck validate_exam_pool job
UPDATE job_queue
SET status = 'cancelled', last_error = 'Forensic fix: HOLLOW_EXAM_POOL - 0 questions despite step=done'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND job_type = 'package_validate_exam_pool'
  AND status = 'pending';

-- Reset validate_exam_pool step from 'enqueued' to 'queued'
UPDATE package_steps
SET status = 'queued', attempts = 0, last_error = NULL, started_at = NULL, finished_at = NULL
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND step_key = 'validate_exam_pool';
