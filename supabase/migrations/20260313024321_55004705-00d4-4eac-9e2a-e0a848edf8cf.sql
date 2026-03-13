
-- Fix deadlock: Reset stuck elite_harden step for Verkäufer package
-- Root cause: PIPELINE_PREREQS drift created false cross-branch dependency
UPDATE package_steps 
SET status = 'queued', 
    started_at = NULL, 
    finished_at = NULL, 
    job_id = NULL, 
    last_error = NULL, 
    last_heartbeat_at = NULL,
    meta = jsonb_set(
      COALESCE(meta, '{}'::jsonb), 
      '{deadlock_fix}', 
      '"prereq_drift_resolved_2026-03-13"'
    ),
    updated_at = now()
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04' 
AND step_key = 'elite_harden'
AND status = 'running';

-- Cancel the stale pending job that can never pass the old prereq guard
UPDATE job_queue 
SET status = 'cancelled', 
    last_error = 'Deadlock fix: PIPELINE_PREREQS drift resolved',
    updated_at = now()
WHERE id = '9ed32fc1-97e0-4b28-ba79-16b1e744854e'
AND status = 'pending';
