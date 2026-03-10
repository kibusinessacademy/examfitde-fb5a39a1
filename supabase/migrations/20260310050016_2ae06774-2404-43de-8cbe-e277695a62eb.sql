
-- Reset generate_handbook step: clear stale "running" state from our manual flush
UPDATE package_steps 
SET status = 'queued', 
    job_id = NULL, 
    runner_id = NULL, 
    started_at = NULL, 
    last_error = NULL,
    attempts = 0,
    meta = '{}'::jsonb
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04' 
  AND step_key = 'generate_handbook';

-- Reset the pending job attempts so it gets picked up fresh
UPDATE job_queue 
SET attempts = 0, 
    last_error = NULL, 
    updated_at = now()
WHERE id = 'b5b15d45-8083-4d85-a223-2a6044f3955d'
  AND package_id = '59b6e214-e181-4c2b-986e-1ce544984d04';

-- Clear blocked_reason on package
UPDATE course_packages 
SET blocked_reason = NULL, 
    last_error = NULL,
    updated_at = now()
WHERE id = '59b6e214-e181-4c2b-986e-1ce544984d04';

-- Release stale lease
DELETE FROM package_leases 
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04';
