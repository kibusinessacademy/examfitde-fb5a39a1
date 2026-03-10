-- Clear all lesson_generate_content jobs
DELETE FROM job_queue WHERE job_type = 'lesson_generate_content';

-- Clear all competency bundle jobs  
DELETE FROM job_queue WHERE job_type = 'lesson_generate_competency_bundle';

-- Clear cooldowns
TRUNCATE llm_provider_cooldowns;

-- Reset any stalled generate_learning_content steps back to queued
UPDATE package_steps 
SET status = 'queued', started_at = NULL, last_error = NULL, 
    updated_at = now()
WHERE step_key = 'generate_learning_content' 
  AND status IN ('running', 'failed');

-- Release stale leases
DELETE FROM package_leases;