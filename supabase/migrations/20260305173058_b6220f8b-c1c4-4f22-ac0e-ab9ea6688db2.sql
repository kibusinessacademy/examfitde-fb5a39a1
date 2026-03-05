
-- Reset only ONE failed lesson job (the orchestrator will re-enqueue the rest)
UPDATE job_queue
SET status = 'pending', 
    attempts = 0,
    locked_by = NULL,
    locked_at = NULL,
    last_error = 'ADMIN_RESET: transient retry',
    updated_at = now()
WHERE id = (
  SELECT id FROM job_queue
  WHERE package_id = '2ec30a3a-7d6e-42bd-a643-e78f6e4c3709'
    AND job_type = 'lesson_generate_content'
    AND status = 'failed'
  ORDER BY created_at DESC
  LIMIT 1
);

-- Re-activate the generate_learning_content step
UPDATE package_steps
SET status = 'running',
    started_at = now(),
    updated_at = now(),
    last_error = NULL
WHERE package_id = '2ec30a3a-7d6e-42bd-a643-e78f6e4c3709'
  AND step_key = 'generate_learning_content'
  AND status = 'queued';
