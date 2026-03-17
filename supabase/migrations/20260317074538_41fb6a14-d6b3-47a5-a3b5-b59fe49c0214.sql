
-- Full Reset: Sozialversicherungsfachangestellter (772e30cf) + IT-System-Elektroniker (180c24a9)

-- Step 1: Cancel all active/failed jobs
UPDATE job_queue 
SET status = 'cancelled', error = 'FULL_RESET: admin initiated', completed_at = now(), updated_at = now()
WHERE package_id IN ('772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1','180c24a9-eba7-4159-ada8-140cee76f947')
AND status IN ('pending','processing','failed');

-- Step 2: Delete generated content (content_versions)
DELETE FROM content_versions 
WHERE course_id IN ('a14b565c-8ae5-43a3-9d6e-f0f854fad002','98c9706f-0377-4ce5-a0af-1d1a635a7907');

-- Step 3: Temporarily disable the content guard trigger, reset lessons, re-enable
ALTER TABLE lessons DISABLE TRIGGER trg_guard_lesson_content;

UPDATE lessons 
SET content = null, status = 'draft', generation_status = null, generation_job_id = null, generation_claimed_at = null, 
    content_hash = null, qc_status = null, quality_gate_status = 'pending', quality_flags = '[]'::jsonb, published_versions = '{}'::jsonb,
    minicheck_parsed = null, quarantine_status = null, quarantine_reason = null, quarantined_at = null
WHERE module_id IN (SELECT id FROM modules WHERE course_id IN ('a14b565c-8ae5-43a3-9d6e-f0f854fad002','98c9706f-0377-4ce5-a0af-1d1a635a7907'));

ALTER TABLE lessons ENABLE TRIGGER trg_guard_lesson_content;

-- Step 4: Delete AI tutor index
DELETE FROM ai_tutor_context_index 
WHERE package_id IN ('772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1','180c24a9-eba7-4159-ada8-140cee76f947');

-- Step 5: Reset all package_steps to queued
UPDATE package_steps 
SET status = 'queued', attempts = 0, last_error = null, started_at = null, finished_at = null, 
    runner_id = null, job_id = null, last_heartbeat_at = null,
    meta = jsonb_build_object('note', 'full_reset_v1', 'reset_at', now()::text),
    updated_at = now()
WHERE package_id IN ('772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1','180c24a9-eba7-4159-ada8-140cee76f947');

-- Step 6: Reset package status to queued, clear blocked_reason, reset build_progress
UPDATE course_packages 
SET status = 'queued', blocked_reason = null, build_progress = 0, updated_at = now()
WHERE id IN ('772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1','180c24a9-eba7-4159-ada8-140cee76f947');

-- Step 7: Log the action
INSERT INTO auto_heal_log (action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
VALUES 
  ('full_reset', 'course_package', '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1', 'admin_manual', 'success', 'Full reset: all content cleared, steps reset to queued', '{"reason":"old_payload_format_without_shard_fields"}'::jsonb),
  ('full_reset', 'course_package', '180c24a9-eba7-4159-ada8-140cee76f947', 'admin_manual', 'success', 'Full reset: all content cleared, steps reset to queued', '{"reason":"old_payload_format_without_shard_fields"}'::jsonb);
