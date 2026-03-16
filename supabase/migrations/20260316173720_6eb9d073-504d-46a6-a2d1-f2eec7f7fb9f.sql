-- 1. Cancel duplicate exam_pool jobs (keep 1 per package)
WITH ranked AS (
  SELECT id, package_id, 
    ROW_NUMBER() OVER (PARTITION BY package_id ORDER BY created_at ASC) as rn
  FROM job_queue
  WHERE status = 'pending' AND job_type = 'package_generate_exam_pool'
)
UPDATE job_queue SET status = 'cancelled', last_error = 'DEDUP_CLEANUP: duplicate jobs removed'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Reset run_after on remaining pending jobs so they run immediately
UPDATE job_queue SET run_after = now(), last_error = NULL
WHERE status = 'pending' AND job_type = 'package_generate_exam_pool';

-- 3. Unblock Industriemechaniker (loop_guard_generate_exam_pool)
UPDATE course_packages 
SET status = 'building', blocked_reason = NULL
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c' 
AND blocked_reason = 'loop_guard_generate_exam_pool';

-- 4. Reset the generate_exam_pool step for Industriemechaniker
UPDATE package_steps 
SET status = 'queued', attempts = 0
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c' 
AND step_key = 'generate_exam_pool';