
-- Apply terminal to Wirtschaftsinformatik with taxonomy-compliant reason
UPDATE course_packages
SET gate_class = 'terminal',
    blocked_reason = 'manual_review_required',
    updated_at = now()
WHERE id = 'c5000000-0004-4000-8000-000000000001'
  AND gate_class IS DISTINCT FROM 'terminal';

-- Cancel remaining open downstream jobs
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'AUTO_CANCELLED: terminal escalation (HARD_FAIL_REPAIR_EXHAUSTED)',
    updated_at = now()
WHERE (payload->>'package_id')::uuid = 'c5000000-0004-4000-8000-000000000001'
  AND status IN ('pending', 'processing');
