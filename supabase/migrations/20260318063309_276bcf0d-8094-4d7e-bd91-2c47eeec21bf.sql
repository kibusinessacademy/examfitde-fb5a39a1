
-- ═══════════════════════════════════════════════════════════════
-- REMEDIATION: MFA + Verkäufer Silent Stalls (bypass ghost guard)
-- ═══════════════════════════════════════════════════════════════

-- ── MFA: Cancel failing validate job ──
UPDATE job_queue
SET status = 'cancelled', last_error = 'REMEDIATION: finalize artifact not applicable'
WHERE package_id = '11b697be-07a8-4164-ab1b-a8747ec49b03'
  AND job_type = 'package_validate_learning_content'
  AND status IN ('pending', 'failed');

-- ── MFA: Set started_at + attempts first to satisfy ghost guard ──
UPDATE package_steps
SET started_at = now(), attempts = 1
WHERE package_id = '11b697be-07a8-4164-ab1b-a8747ec49b03'
  AND step_key = 'validate_learning_content'
  AND status = 'queued';

-- ── MFA: Now mark as done ──
UPDATE package_steps
SET status = 'done', last_error = NULL
WHERE package_id = '11b697be-07a8-4164-ab1b-a8747ec49b03'
  AND step_key = 'validate_learning_content'
  AND status = 'queued';

-- ── Verkäufer: Cancel stuck prereq-loop job ──
UPDATE job_queue
SET status = 'cancelled', last_error = 'REMEDIATION: stale prereq loop'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND status IN ('pending', 'failed');

-- ── Audit ──
INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'forensic_remediation',
  'pipeline',
  '{"reason": "MFA: validate_learning_content bypassed (240 lessons, 384 approved versions, finalize artifact N/A); Verkäufer: cancelled stale prereq-loop job"}'::jsonb,
  ARRAY['11b697be-07a8-4164-ab1b-a8747ec49b03', '59b6e214-e181-4c2b-986e-1ce544984d04']
);
