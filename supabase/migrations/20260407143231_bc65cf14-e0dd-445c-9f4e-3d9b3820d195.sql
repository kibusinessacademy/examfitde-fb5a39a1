
-- Heal fanout_learning_content step: reset from failed to queued
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"healed_at": "2026-04-07T14:35:00Z", "healed_reason": "prereq_done_but_step_failed_burn_guard"}'::jsonb
WHERE package_id = '24c3793c-30b0-43a7-bd5d-cfed0c40542d'
  AND step_key = 'fanout_learning_content'
  AND status = 'failed';

-- Reset the fanout job: clear burn guard metadata, reset attempts
UPDATE job_queue
SET attempts = 0,
    last_error = NULL,
    started_at = NULL,
    run_after = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"healed_at": "2026-04-07T14:35:00Z", "prereq_retries": 0}'::jsonb
WHERE id = '795e9be7-c075-46d7-8838-dad4e4cf1884'
  AND status = 'pending';

-- Clear stale unknown_job_type error on auto_seed_exam_blueprints job
UPDATE job_queue
SET last_error = NULL,
    meta = (COALESCE(meta, '{}'::jsonb) - 'error_kind' - 'last_error_class') || '{"healed_at": "2026-04-07T14:35:00Z"}'::jsonb,
    max_attempts = 25
WHERE id = '45b0154d-cc3a-40e1-9a0d-1c0d0ae15662'
  AND status = 'pending';
