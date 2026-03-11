
-- Reset the stuck validate_exam_pool job's artifact storm meta
UPDATE job_queue
SET meta = '{}'::jsonb,
    last_error = NULL,
    started_at = NULL,
    status = 'pending'
WHERE id = 'a1ffab6b-782d-4ebb-963b-ef47c69e2a54';
