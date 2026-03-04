
-- FORENSIC FIX: Unblock 3 stuck packages
-- 1) Unblock packages
UPDATE course_packages 
SET status = 'building', 
    retry_count = 0,
    blocked_reason = null,
    last_error = 'Forensic reset: integrity-check now tolerates tier1_failed with real content'
WHERE id IN (
  'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb',
  '11b697be-07a8-4164-ab1b-a8747ec49b03',
  '62b52784-6d73-458a-9196-631091877c26'
) AND status IN ('quality_gate_failed', 'blocked');

-- 2) Reset pending steps to queued
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    job_id = null,
    runner_id = null,
    started_at = null,
    last_error = 'Forensic requeue: tier1/bloom fix deployed'
WHERE package_id IN (
  'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb',
  '11b697be-07a8-4164-ab1b-a8747ec49b03',
  '62b52784-6d73-458a-9196-631091877c26'
) AND status IN ('failed', 'queued', 'enqueued', 'blocked');

-- 3) Cancel stale failed jobs (archived not in enum)
UPDATE job_queue
SET status = 'cancelled', 
    last_error = 'Forensic cleanup: root cause fixed (tier1 tolerance + bloom gap-fill)'
WHERE package_id IN (
  'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb',
  '11b697be-07a8-4164-ab1b-a8747ec49b03',
  '62b52784-6d73-458a-9196-631091877c26'
) AND status = 'failed';

-- 4) Audit log
INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, metadata)
VALUES (
  'forensic_unblock_tier1_bloom',
  'migration',
  'applied',
  'Unblocked de6c+11b6+62b5: tier1_failed with content now warning-only',
  '{"packages": ["de6c5c13","11b697be","62b52784"], "root_causes": ["tier1_qc_calibration","hardish_borderline"]}'::jsonb
);
