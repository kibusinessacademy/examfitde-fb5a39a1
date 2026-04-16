
-- 1. Stop exam_pool requeue loop for STUDIUM test package d2000001
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'CANCELLED: STUDIUM test package has no exam questions — exam_pool not applicable',
    completed_at = now()
WHERE package_id = 'd2000001-0009-4000-8000-000000000001'
  AND job_type = 'package_generate_exam_pool'
  AND status IN ('pending', 'processing');

-- Also mark the step as skipped
UPDATE package_steps
SET status = 'skipped',
    last_error = 'STUDIUM test package — no exam questions available'
WHERE package_id = 'd2000001-0009-4000-8000-000000000001'
  AND step_key = 'generate_exam_pool'
  AND status NOT IN ('done', 'skipped');

-- 2. Stop glossary loop for same package (will work after post-condition fix)
UPDATE job_queue
SET status = 'pending',
    attempts = 0,
    started_at = NULL,
    completed_at = NULL,
    last_error = 'RESET: post-condition fix deployed — STUDIUM beruf_id skip now allowed'
WHERE id = '7b335bda-58a7-46c7-b464-851dfc329675'
  AND job_type = 'package_generate_glossary';

-- 3. Reset validate_handbook for Bankfachwirt (code fix: empty chapter no longer hard gate)
UPDATE job_queue
SET attempts = 0,
    last_error = 'RESET: code fix — empty chapters no longer hard-block overallPass'
WHERE id = 'd64a6346-38f4-419d-81d6-f97b87ec5474'
  AND job_type = 'package_validate_handbook';

UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL
WHERE package_id = '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8'
  AND step_key = 'validate_handbook'
  AND status = 'failed';

-- 4. Reset generate_oral_exam for de6c5c13 (code fix: coverage guarantee)
UPDATE job_queue
SET attempts = 0,
    last_error = 'RESET: coverage guarantee fix — dedup can no longer drop competencies'
WHERE id = '55915771-0c7a-46e6-b09d-40b9d7c592e8'
  AND job_type = 'package_generate_oral_exam';

UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL
WHERE package_id = 'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb'
  AND step_key = 'generate_oral_exam'
  AND status = 'failed';
