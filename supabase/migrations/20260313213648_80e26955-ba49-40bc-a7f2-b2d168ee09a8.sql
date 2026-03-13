
-- Fix 1: Büromanagement — Reset 73 false-positive tier1_failed questions to pending
UPDATE exam_questions
SET qc_status = 'pending'
WHERE curriculum_id = (SELECT curriculum_id FROM course_packages WHERE id = '5377ab93-fe17-488c-a266-bdb26b672da7')
AND qc_status = 'tier1_failed';

-- Fix 2: Reset validate_exam_pool to let it re-run with fixed logic
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = 'forensic-fix: reset after ANSWER_MISMATCH false-positive fix (73 questions cleared)'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
AND step_key = 'validate_exam_pool'
AND status IN ('queued', 'enqueued', 'running');

-- Fix 3: Industriemechaniker — Cancel stuck infinite-loop minicheck job
UPDATE job_queue 
SET status = 'cancelled', 
    last_error = 'forensic-fix: cancelled infinite loop caused by 1000-row limit bug'
WHERE payload->>'package_id' = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
AND job_type = 'package_generate_lesson_minichecks'
AND status IN ('pending', 'processing');

-- Fix 4: Reset Industriemechaniker minicheck step for fresh dispatch
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = 'forensic-fix: reset after 1000-row-limit infinite loop fix'
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
AND step_key = 'generate_lesson_minichecks'
AND status IN ('enqueued', 'running', 'queued');
