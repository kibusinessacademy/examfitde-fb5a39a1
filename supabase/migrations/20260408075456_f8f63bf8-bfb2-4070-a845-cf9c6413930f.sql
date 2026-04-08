
-- First set allow_regression, then change status
UPDATE package_steps SET 
  meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('allow_regression', true, 'allow_regression_by', 'admin_manual')
WHERE package_id = '65430b12-b481-46e0-88f4-c88606857da7' AND step_key = 'validate_exam_pool';

UPDATE package_steps SET 
  status = 'queued', started_at = NULL, finished_at = NULL, last_error = NULL,
  meta = meta || jsonb_build_object('reset_reason', 'competency_id_repair_1860_approved', 'reset_at', now()::text)
WHERE package_id = '65430b12-b481-46e0-88f4-c88606857da7' AND step_key = 'validate_exam_pool';
