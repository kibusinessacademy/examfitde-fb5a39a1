
-- FORENSIC RESET v2: generate_handbook completed with 0 sections_this_batch due to write-guard rejections
-- Fixes deployed: content-runner zero-progress guard + pipeline-process handbook completion guard

-- 1. Reset generate_handbook to queued
UPDATE package_steps 
SET status = 'queued', 
    job_id = NULL, 
    runner_id = NULL, 
    started_at = NULL, 
    last_error = 'forensic_reset_v2: 0/10 LFs populated, all sections rejected by write-guard',
    attempts = 0,
    meta = '{}'::jsonb,
    updated_at = now()
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04' 
  AND step_key = 'generate_handbook';

-- 2. Reset validate_handbook  
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

-- 3. Cancel all pending/processing validate_handbook jobs
UPDATE job_queue 
SET status = 'cancelled', 
    last_error = 'forensic_reset_v2: generate_handbook had 0 sections written',
    updated_at = now()
WHERE payload->>'package_id' = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND job_type IN ('package_generate_handbook', 'package_validate_handbook')
  AND status IN ('pending', 'processing');

-- 4. Release stale lease
DELETE FROM package_leases 
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04';
