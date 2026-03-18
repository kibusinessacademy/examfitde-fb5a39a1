-- Unblock validate_exam_pool step after CPU timeout fix deployment
UPDATE package_steps 
SET status = 'queued', 
    meta = meta || '{"unblocked_reason": "CPU timeout fix: PAGE_SIZE 300->100, JACCARD_WINDOW 80->30, TIME_BUDGET 50s->40s", "unblocked_at": "2026-03-18T05:15:00Z"}'::jsonb
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c' 
  AND step_key = 'validate_exam_pool' 
  AND status = 'blocked';

-- Unblock package
UPDATE course_packages SET status = 'building' WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c' AND status = 'blocked';

-- Cancel all stale gpt-5.4-mini batches that are still validating/in_progress
UPDATE llm_batches 
SET status = 'cancelled'
WHERE model = 'gpt-5.4-mini' AND status IN ('validating', 'in_progress', 'uploading');