
-- Fix: Reset generate_handbook to queued (only 1/5 chapters covered)
UPDATE package_steps
SET status = 'queued', 
    started_at = NULL, 
    job_id = NULL,
    runner_id = NULL,
    updated_at = now(),
    meta = jsonb_set(
      COALESCE(meta, '{}'::jsonb), 
      '{forensic_reset_v3}', 
      '"only_1_of_5_chapters_covered_completion_guard_was_broken"'
    )
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'generate_handbook';

-- Cancel stuck validate_handbook job
UPDATE job_queue
SET status = 'cancelled', 
    last_error = 'forensic_reset_v3: generate_handbook only had 1/5 chapters',
    updated_at = now()
WHERE id = 'ca3d8520-0b3d-4a0b-8e65-9d7d31a4040a'
  AND status = 'pending';

-- Reset validate_handbook step
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    job_id = NULL,
    runner_id = NULL,
    updated_at = now()
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'validate_handbook';
