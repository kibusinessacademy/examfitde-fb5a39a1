
-- Force build_ai_tutor_index to done with postcondition_verified
UPDATE package_steps SET 
  status = 'done', finished_at = now(),
  meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
    'force_done_reason', 'admin_13_completed_jobs', 
    'force_done_at', now()::text,
    'postcondition_verified', true
  )
WHERE package_id = '65430b12-b481-46e0-88f4-c88606857da7' AND step_key = 'build_ai_tutor_index';

-- Cancel stale jobs
UPDATE job_queue SET status = 'cancelled'
WHERE package_id = '65430b12-b481-46e0-88f4-c88606857da7'
  AND job_type = 'build_ai_tutor_index' AND status IN ('pending', 'processing');
