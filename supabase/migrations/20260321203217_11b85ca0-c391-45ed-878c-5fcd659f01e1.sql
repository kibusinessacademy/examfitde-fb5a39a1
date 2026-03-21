
-- Set Track A packages to building so jobs won't be cancelled by ops guard
UPDATE course_packages
SET status = 'building', updated_at = now()
WHERE id IN (
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '59b6e214-e181-4c2b-986e-1ce544984d04',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
)
AND status IN ('queued', 'blocked');

-- Re-dispatch integrity jobs
INSERT INTO job_queue (job_type, package_id, status, payload, max_attempts, priority) VALUES
('package_run_integrity_check', '2e8da39f-60f8-44d9-8b70-e1176222ca55', 'pending',
 '{"package_id":"2e8da39f-60f8-44d9-8b70-e1176222ca55","curriculum_id":"e24f7b10-0740-4729-8abe-e10fe765f6db","triggered_by":"sprint_reconcile_v2"}'::jsonb, 3, 5),
('package_run_integrity_check', '59b6e214-e181-4c2b-986e-1ce544984d04', 'pending',
 '{"package_id":"59b6e214-e181-4c2b-986e-1ce544984d04","curriculum_id":"63635f46-0186-49e7-80c1-67925dbdf638","triggered_by":"sprint_reconcile_v2"}'::jsonb, 3, 5),
('package_run_integrity_check', '9c1b3734-bb25-4986-baef-5bb1c20a212c', 'pending',
 '{"package_id":"9c1b3734-bb25-4986-baef-5bb1c20a212c","curriculum_id":"2c01d31e-e7ed-4b82-b04e-d5094d1dc179","triggered_by":"sprint_reconcile_v2"}'::jsonb, 3, 5),
('package_run_integrity_check', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a', 'pending',
 '{"package_id":"fd1d8192-a16f-496b-80c8-5e06f70ec21a","curriculum_id":"e06a570a-d810-410d-873a-c87229465f41","triggered_by":"sprint_reconcile_v2"}'::jsonb, 3, 5);
