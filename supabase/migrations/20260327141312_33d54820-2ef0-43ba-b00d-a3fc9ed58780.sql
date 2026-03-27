
-- Reset integrity steps on base table
UPDATE package_steps
SET status = 'queued', last_error = NULL
WHERE package_id IN ('fd1d8192-a16f-496b-80c8-5e06f70ec21a', '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1')
  AND step_key IN ('run_integrity_check', 'auto_publish');

-- Set packages to building
UPDATE course_packages
SET status = 'building', blocked_reason = NULL
WHERE id IN ('fd1d8192-a16f-496b-80c8-5e06f70ec21a', '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1');

-- Enqueue integrity checks
INSERT INTO job_queue (job_type, package_id, status, priority, payload, created_at)
VALUES 
  ('package_run_integrity_check', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a', 'pending', 1,
   '{"package_id":"fd1d8192-a16f-496b-80c8-5e06f70ec21a","curriculum_id":"e06a570a-d810-410d-873a-c87229465f41","reason":"elite_gap_fix_revalidation"}'::jsonb, now()),
  ('package_run_integrity_check', '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1', 'pending', 1,
   '{"package_id":"772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1","curriculum_id":"2b9715cb-6cea-40ab-8a34-16cec0b1e74c","reason":"elite_gap_fix_revalidation"}'::jsonb, now());
