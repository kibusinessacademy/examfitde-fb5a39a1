
-- Clean up failed/cancelled jobs for the affected package
UPDATE job_queue
SET status = 'cancelled', last_error = 'cleaned: routing fix applied — all-OpenAI chain replaced with cross-provider'
WHERE status = 'failed'
  AND job_type IN ('package_generate_exam_pool', 'package_validate_exam_pool')
  AND created_at > now() - interval '48 hours';

-- Reset package_steps for the affected package to allow fresh dispatch
UPDATE package_steps
SET status = 'queued', attempts = 0, last_error = NULL, started_at = NULL, finished_at = NULL,
    meta = jsonb_set(COALESCE(meta, '{}'), '{routing_fix}', '"cross_provider_fallback_added"')
WHERE package_id = '2e8da39f-60f8-44d9-8b70-e1176222ca55'
  AND step_key IN ('generate_exam_pool', 'validate_exam_pool');
