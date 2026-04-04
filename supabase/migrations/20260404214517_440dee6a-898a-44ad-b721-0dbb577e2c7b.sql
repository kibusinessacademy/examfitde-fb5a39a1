
-- Reset run_integrity_check from done to queued
UPDATE package_steps 
SET status = 'queued', 
    meta = meta || jsonb_build_object(
      'allow_regression', true,
      'allow_regression_by', 'admin_manual',
      'last_reset_reason', 'post_rebalance_pipeline_restart',
      'pipeline_restart_at', now()::text
    )
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04' 
  AND step_key = 'run_integrity_check';

-- Reset auto_publish cancel count
UPDATE package_steps 
SET meta = meta || jsonb_build_object(
      'allow_regression', true,
      'allow_regression_by', 'admin_manual',
      'last_reset_reason', 'post_rebalance_pipeline_restart',
      'auto_publish_cancel_count', 0
    )
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04' 
  AND step_key = 'auto_publish';

-- Set package back to building
UPDATE course_packages SET status = 'building' WHERE id = '59b6e214-e181-4c2b-986e-1ce544984d04';
