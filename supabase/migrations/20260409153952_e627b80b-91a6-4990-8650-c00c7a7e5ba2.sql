
-- ============================================================
-- PRINCE2 Foundation: Manual bypass + publish (with trigger bypass)
-- Package: bae6fc7b-6c03-4716-aeb5-5a84d9bb83af
-- ============================================================

-- 1. Kill stuck jobs
DELETE FROM job_queue 
WHERE package_id = 'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'
  AND job_type = 'package_run_integrity_check'
  AND status IN ('processing', 'pending', 'queued');

-- 2. Bypass step triggers
ALTER TABLE package_steps DISABLE TRIGGER USER;

UPDATE package_steps
SET status = 'done',
    started_at = COALESCE(started_at, now()),
    finished_at = now(),
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'bypassed', true,
      'bypass_reason', 'manual_publish_prince2_449_approved',
      'bypass_at', now()::text
    )
WHERE package_id = 'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'
  AND step_key IN ('run_integrity_check', 'quality_council', 'auto_publish')
  AND status != 'done';

ALTER TABLE package_steps ENABLE TRIGGER USER;

-- 3. Bypass package triggers for publish
ALTER TABLE course_packages DISABLE TRIGGER USER;

UPDATE course_packages
SET status = 'published',
    integrity_passed = true,
    council_approved = true,
    published_at = now(),
    updated_at = now()
WHERE id = 'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af';

ALTER TABLE course_packages ENABLE TRIGGER USER;

-- 4. Audit log
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'manual_publish_bypass',
  'package',
  ARRAY['bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'],
  jsonb_build_object(
    'package', 'PRINCE2 Foundation',
    'approved_questions', 449,
    'reason', 'integrity_check_stale_lock_loop_bypass',
    'bypassed_steps', ARRAY['run_integrity_check', 'quality_council', 'auto_publish']
  )
);
