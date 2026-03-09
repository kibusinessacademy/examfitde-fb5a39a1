
-- OPERATIONAL FIX 1: Reset Verkäufer generate_handbook (done but 4/5 chapters empty)
UPDATE package_steps 
SET status = 'queued', job_id = NULL, started_at = NULL, last_heartbeat_at = NULL,
    last_error = 'SSOT fix: generate_handbook was done but 4/5 chapters empty'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key IN ('generate_handbook', 'validate_handbook');

-- OPERATIONAL FIX 2: Demote Büromanagement to queued (WIP enforcement)
UPDATE course_packages 
SET status = 'queued', updated_at = now()
WHERE id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND status = 'building';

-- OPERATIONAL FIX 2b: Cancel active jobs for demoted package
UPDATE job_queue 
SET status = 'cancelled', last_error = 'WIP enforcement: package demoted to queued'
WHERE payload->>'package_id' = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND status IN ('pending', 'processing');
