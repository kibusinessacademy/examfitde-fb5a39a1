
-- Cancel broken handbook_expand_section jobs without section_id for Verkäufer package
UPDATE job_queue 
SET status = 'cancelled', last_error = 'AUTO_FIX: cancelled job without section_id (fan-out guard fix applied)'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND job_type = 'handbook_expand_section'
  AND status IN ('pending', 'processing')
  AND (payload->>'section_id') IS NULL;

-- Also reset the expand_handbook step so the pipeline runner retries it cleanly
UPDATE package_steps
SET status = 'queued', job_id = NULL, runner_id = NULL, started_at = NULL, attempts = 0
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'expand_handbook';
