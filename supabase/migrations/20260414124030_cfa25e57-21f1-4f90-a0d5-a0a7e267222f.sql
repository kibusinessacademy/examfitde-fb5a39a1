
-- Step 1: Cancel all existing handbook jobs for these packages
UPDATE job_queue
SET status = 'cancelled',
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'superseded_by_v23_redeploy',
      'transition_source', 'migration_v23_cleanup',
      'transition_prev_status', status
    ),
    updated_at = now()
WHERE job_type = 'package_generate_handbook'
  AND status IN ('failed', 'pending')
  AND package_id IN (
    '3e070545-c555-417a-a047-c7541ebb2a7c',
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b',
    '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9'
  );

-- Step 2: Insert fresh pending jobs
INSERT INTO job_queue (job_type, package_id, status, priority, attempts, max_attempts, payload, meta)
VALUES
  ('package_generate_handbook', '3e070545-c555-417a-a047-c7541ebb2a7c', 'pending', 10, 0, 5,
   '{"package_id":"3e070545-c555-417a-a047-c7541ebb2a7c","curriculum_id":"75359e28-34f6-422a-aa0a-9b73d271271d"}'::jsonb,
   '{"source": "migration_v23_redeploy"}'::jsonb),
  ('package_generate_handbook', 'ba96f6d9-c638-4bf3-aaca-3465ac363e8b', 'pending', 10, 0, 5,
   '{"package_id":"ba96f6d9-c638-4bf3-aaca-3465ac363e8b","curriculum_id":"192b4310-baea-42c5-a1ff-69cf2711a6dd"}'::jsonb,
   '{"source": "migration_v23_redeploy"}'::jsonb),
  ('package_generate_handbook', '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9', 'pending', 10, 0, 5,
   '{"package_id":"176f51ad-fe34-596e-9b3d-d1c9cd23b0a9","curriculum_id":"c448a7f5-b677-55bf-8a60-1c762317045c"}'::jsonb,
   '{"source": "migration_v23_redeploy"}'::jsonb);
