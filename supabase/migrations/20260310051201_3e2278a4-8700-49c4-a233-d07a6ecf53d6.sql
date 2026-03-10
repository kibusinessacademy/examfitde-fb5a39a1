
-- FORENSIC FIX: generate_handbook completed with only 1/5 chapters populated (SSOT violation)
-- Reset both generate_handbook AND validate_handbook to re-run with fixed edge function

-- 1. Reset generate_handbook step to queued (so it re-generates missing 4 chapters)
UPDATE package_steps 
SET status = 'queued', 
    job_id = NULL, 
    runner_id = NULL, 
    started_at = NULL, 
    last_error = NULL,
    attempts = 0,
    meta = '{}'::jsonb,
    updated_at = now()
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04' 
  AND step_key = 'generate_handbook';

-- 2. Reset validate_handbook step  
UPDATE package_steps 
SET status = 'queued', 
    job_id = NULL, 
    runner_id = NULL, 
    started_at = NULL, 
    last_error = NULL,
    attempts = 0,
    meta = '{}'::jsonb,
    updated_at = now()
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04' 
  AND step_key = 'validate_handbook';

-- 3. Cancel the stuck validate_handbook job
UPDATE job_queue 
SET status = 'cancelled', 
    last_error = 'forensic_reset: generate_handbook had only 1/5 chapters',
    updated_at = now()
WHERE id = '19c98bd3-704b-4fbc-b486-46997087c88c';

-- 4. Release stale lease
DELETE FROM package_leases 
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04';
