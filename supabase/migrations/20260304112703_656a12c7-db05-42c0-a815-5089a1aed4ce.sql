
-- Unblock MFA & PKA from QG_HEAL_EXHAUSTED
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id IN (
  '11b697be-07a8-4164-ab1b-a8747ec49b03',
  '62b52784-6d73-458a-9196-631091877c26'
);

-- Reset their stuck steps (run_integrity_check, quality_council, auto_publish)
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    meta = coalesce(meta, '{}'::jsonb)
           - 'stall_runs' - 'last_error' - 'last_error_kind'
           - 'last_error_class' - 'escalated' - 'auto_rebuild'
           - 'qg_heal_runs' - 'qg_heal_exhausted',
    updated_at = now()
WHERE package_id IN (
  '11b697be-07a8-4164-ab1b-a8747ec49b03',
  '62b52784-6d73-458a-9196-631091877c26'
)
AND step_key IN ('run_integrity_check', 'quality_council', 'auto_publish')
AND status != 'done';

-- Also cancel failed auto_publish jobs for Bankkaufmann to allow clean requeue
UPDATE job_queue
SET status = 'cancelled',
    updated_at = now()
WHERE job_type = 'package_auto_publish'
  AND status = 'failed'
  AND package_id = 'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb';
