
INSERT INTO job_queue (id, job_type, status, payload, priority, package_id, worker_pool)
VALUES (
  gen_random_uuid(), 
  'package_run_integrity_check', 
  'pending',
  jsonb_build_object(
    'package_id', '59b6e214-e181-4c2b-986e-1ce544984d04',
    'curriculum_id', '63635f46-0a4e-4e7f-96f0-cc0579a37498',
    'reason', 'post_rebalance_pipeline_restart'
  ),
  1,
  '59b6e214-e181-4c2b-986e-1ce544984d04',
  'content'
);
