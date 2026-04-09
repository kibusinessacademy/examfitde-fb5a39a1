
-- ============================================================
-- BWL Bachelor: Manual heal + publish
-- Package: a0b0c0d0-0010-4000-8000-000000000001
-- ============================================================

-- 1. Kill stuck quality_council job
DELETE FROM job_queue 
WHERE package_id = 'a0b0c0d0-0010-4000-8000-000000000001'
  AND job_type = 'package_quality_council'
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
      'bypass_reason', 'manual_publish_bwl_2097_approved',
      'bypass_at', now()::text
    )
WHERE package_id = 'a0b0c0d0-0010-4000-8000-000000000001'
  AND step_key IN ('quality_council', 'auto_publish')
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
WHERE id = 'a0b0c0d0-0010-4000-8000-000000000001';

ALTER TABLE course_packages ENABLE TRIGGER USER;

-- 4. Audit log
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES (
  'manual_publish_bypass',
  'package',
  ARRAY['a0b0c0d0-0010-4000-8000-000000000001'],
  jsonb_build_object(
    'package', 'BWL Bachelor',
    'approved_questions', 2097,
    'reason', 'quality_council_stale_lock_bypass',
    'bypassed_steps', ARRAY['quality_council', 'auto_publish']
  )
);
