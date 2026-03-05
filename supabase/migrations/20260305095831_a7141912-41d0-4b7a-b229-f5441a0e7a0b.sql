-- ═══════════════════════════════════════════════════════════════
-- MANUAL REGENERATION RESET for PKA + MFA (tier1_failed content)
-- Packages: 62b52784 (PKA), 11b697be (MFA)
-- Root cause: Content generated pre-v9.2 was too short (~786 chars),
-- Quality Council correctly rejected 184+ versions, but auto-heal
-- has no handler for LESSON_QUALITY/tier1_failed → DEADLOCK.
-- ═══════════════════════════════════════════════════════════════

-- 1. Reset lesson qc_status so they get re-generated
UPDATE lessons
SET qc_status = NULL, quality_gate_status = 'pending'
WHERE module_id IN (
  SELECT m.id FROM modules m
  WHERE m.course_id IN (
    SELECT course_id FROM course_packages 
    WHERE id IN ('62b52784-6d73-458a-9196-631091877c26', '11b697be-07a8-4164-ab1b-a8747ec49b03')
  )
)
AND qc_status = 'tier1_failed';

-- 2. Reset pipeline steps: content gen + all downstream
UPDATE package_steps
SET status = 'queued', attempts = 0, 
    last_error = 'MANUAL_REGEN: tier1_failed content reset for v9.4 regeneration'
WHERE package_id IN ('62b52784-6d73-458a-9196-631091877c26', '11b697be-07a8-4164-ab1b-a8747ec49b03')
  AND step_key IN (
    'generate_learning_content', 
    'validate_learning_content', 
    'quality_council', 
    'run_integrity_check', 
    'auto_publish'
  );

-- 3. Cancel any stuck/pending auto_publish jobs for these packages
UPDATE job_queue
SET status = 'cancelled', last_error = 'MANUAL_REGEN: cancelled for content regeneration reset'
WHERE (payload->>'package_id' IN ('62b52784-6d73-458a-9196-631091877c26', '11b697be-07a8-4164-ab1b-a8747ec49b03')
   OR payload::text ILIKE '%62b52784%' OR payload::text ILIKE '%11b697be%')
  AND job_type = 'package_auto_publish'
  AND status IN ('pending', 'processing', 'queued');

-- 4. Reset integrity_passed so the package is re-evaluated
UPDATE course_packages
SET integrity_passed = false, 
    integrity_report = NULL
WHERE id IN ('62b52784-6d73-458a-9196-631091877c26', '11b697be-07a8-4164-ab1b-a8747ec49b03');

-- 5. Log admin action for audit trail
INSERT INTO admin_actions (action, payload)
VALUES (
  'manual_regen_tier1_failed_reset',
  '{"packages": ["62b52784-6d73-458a-9196-631091877c26", "11b697be-07a8-4164-ab1b-a8747ec49b03"], "reason": "214+237 tier1_failed lessons, auto-heal has no handler for LESSON_QUALITY, content generated pre-v9.2 was too short", "version": "v9.4"}'::jsonb
);