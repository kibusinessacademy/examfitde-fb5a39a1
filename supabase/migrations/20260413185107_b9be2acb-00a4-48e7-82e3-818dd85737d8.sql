
-- ═══════════════════════════════════════════════════════════════
-- P0 FIX: package_generate_handbook max_processing = 0 → 5
-- This was causing FINISH_LINE_GUARD to release every claimed handbook
-- job, creating a claim-release loop that starved ALL other generation jobs.
-- ═══════════════════════════════════════════════════════════════
UPDATE jobtype_limits 
SET max_processing = 5 
WHERE job_type = 'package_generate_handbook' AND max_processing = 0;

-- ═══════════════════════════════════════════════════════════════
-- Clean up STALE_LOCK_RECOVERY loops: reset all processing jobs
-- that have stale lock errors
-- ═══════════════════════════════════════════════════════════════
UPDATE job_queue
SET 
  status = 'pending',
  locked_at = NULL,
  locked_by = NULL,
  run_after = now() + interval '2 minutes',
  updated_at = now()
WHERE status = 'processing'
  AND last_error LIKE 'STALE_LOCK_RECOVERY%'
  AND updated_at < now() - interval '5 minutes';

-- Also reset processing jobs that have been idle > 10 min (zombie locks)
UPDATE job_queue
SET 
  status = 'pending',
  locked_at = NULL,
  locked_by = NULL,
  run_after = now() + interval '1 minute',
  updated_at = now()
WHERE status = 'processing'
  AND locked_at < now() - interval '10 minutes'
  AND job_type NOT IN ('package_generate_learning_content'); -- keep active dispatchers

-- ═══════════════════════════════════════════════════════════════
-- Reset MATERIALIZATION_GUARD failed handbook jobs now that limit is fixed
-- ═══════════════════════════════════════════════════════════════
UPDATE job_queue
SET
  status = 'pending',
  attempts = 0,
  last_error = NULL,
  run_after = now() + interval '1 minute',
  updated_at = now()
WHERE job_type = 'package_generate_handbook'
  AND status = 'failed'
  AND last_error LIKE '%MATERIALIZATION_GUARD%';
