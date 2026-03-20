
-- ============================================================
-- Remediation: Unblock 2 packages with PERSISTENCE_DEFECT
-- Both have run_integrity_check=done but integrity_report IS NULL
-- ============================================================

-- 1. Reset run_integrity_check step to queued for re-run
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    meta = meta || '{"remediation": "persistence_defect_rerun", "remediation_at": "2026-03-20T21:00:00Z"}'::jsonb
WHERE package_id IN (
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '11b697be-07a8-4164-ab1b-a8747ec49b03'
)
AND step_key = 'run_integrity_check';

-- 2. Reset auto_publish step from blocked to queued
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    meta = jsonb_build_object(
      'remediation', 'unblocked_after_persistence_defect',
      'remediation_at', '2026-03-20T21:00:00Z',
      'previous_cancel_count', COALESCE((meta->>'auto_publish_cancel_count')::int, 0)
    )
WHERE package_id IN (
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '11b697be-07a8-4164-ab1b-a8747ec49b03'
)
AND step_key = 'auto_publish';

-- 3. Unblock packages: set status to building, clear blocked_reason
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id IN (
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '11b697be-07a8-4164-ab1b-a8747ec49b03'
)
AND status = 'blocked';

-- 4. Audit trail
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'remediation_persistence_defect',
  'package',
  ARRAY['2e8da39f-60f8-44d9-8b70-e1176222ca55', '11b697be-07a8-4164-ab1b-a8747ec49b03'],
  '{"reason": "run_integrity_check done but integrity_report IS NULL (PERSISTENCE_DEFECT). Reset integrity + auto_publish steps for re-run.", "steps_reset": ["run_integrity_check", "auto_publish"]}'::jsonb
);
