
-- ============================================================
-- HEAL 1: Loop-Guard packages (335decc8, eff99cc4)
-- Root cause: 100% content generated but generate_learning_content 
-- stuck in blocked by loop_guard (80 jobs in 24h). 
-- Fix: set step to done, unblock package, reset downstream.
-- ============================================================

-- Set generate_learning_content to done (100% content exists)
UPDATE public.package_steps
SET status = 'done',
    finished_at = now(),
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'healed_by', 'forensic_heal_2026-03-23',
      'healed_at', now(),
      'heal_reason', 'loop_guard_blocked_but_100pct_content_generated',
      'completion_ratio', 1.0
    )
WHERE package_id IN (
  '335decc8-9f68-4784-b318-a68f620bf77e',
  'eff99cc4-785d-4f61-a3ef-12932d8043c3'
)
AND step_key = 'generate_learning_content';

-- Unblock packages -> building
UPDATE public.course_packages
SET status = 'building',
    blocked_reason = NULL,
    stuck_reason = NULL,
    updated_at = now()
WHERE id IN (
  '335decc8-9f68-4784-b318-a68f620bf77e',
  'eff99cc4-785d-4f61-a3ef-12932d8043c3'
)
AND status = 'blocked';

-- ============================================================
-- HEAL 2: Auto-publish-gate packages (fd1d8192, a9f19137)
-- Root cause: integrity_report IS NULL but integrity_passed=false.
-- integrity_report_version is set but report was stripped.
-- Fix: reset integrity check + auto_publish steps, unblock.
-- ============================================================

UPDATE public.package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'healed_by', 'forensic_heal_2026-03-23',
      'healed_at', now(),
      'heal_reason', 'integrity_report_null_despite_version_set'
    )
WHERE package_id IN (
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
  'a9f19137-a004-4850-838a-bdc8f8a705f5'
)
AND step_key IN ('run_integrity_check', 'auto_publish');

-- Clear stale integrity state so re-check can run clean
UPDATE public.course_packages
SET status = 'building',
    blocked_reason = NULL,
    stuck_reason = NULL,
    integrity_passed = false,
    integrity_report = NULL,
    integrity_report_version = NULL,
    updated_at = now()
WHERE id IN (
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
  'a9f19137-a004-4850-838a-bdc8f8a705f5'
)
AND status = 'blocked';

-- ============================================================
-- HEAL 3: 570ccb3e - validate_learning_content stuck in queued
-- Root cause: finalize_learning_content=done but validate_learning_content
-- was cascade-reset and never re-dispatched. No active job exists.
-- Fix: reset validate step cleanly so orchestrator picks it up.
-- ============================================================

UPDATE public.package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'healed_by', 'forensic_heal_2026-03-23',
      'healed_at', now(),
      'heal_reason', 'validate_stuck_after_cascade_reset_no_job_dispatched',
      'loop_guard_reset_at', now()
    )
WHERE package_id = '570ccb3e-2937-4d81-b3d8-624b9be84737'
AND step_key = 'validate_learning_content'
AND status = 'queued';

-- Also reset all downstream steps that failed due to PREREQ_NOT_DONE
UPDATE public.package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'healed_by', 'forensic_heal_2026-03-23',
      'healed_at', now(),
      'heal_reason', 'prereq_cascade_from_validate_heal'
    )
WHERE package_id = '570ccb3e-2937-4d81-b3d8-624b9be84737'
AND step_key IN ('generate_exam_pool', 'generate_handbook', 'generate_lesson_minichecks', 'generate_oral_exam', 'auto_seed_exam_blueprints')
AND status = 'queued';

-- Log heals
INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
VALUES
  ('forensic_heal', 'manual_admin', 'package', '335decc8-9f68-4784-b318-a68f620bf77e', 'healed', 'loop_guard_blocked_100pct_content: set generate_learning_content=done, unblocked', '{"heal_batch": "2026-03-23_forensic"}'::jsonb),
  ('forensic_heal', 'manual_admin', 'package', 'eff99cc4-785d-4f61-a3ef-12932d8043c3', 'healed', 'loop_guard_blocked_100pct_content: set generate_learning_content=done, unblocked', '{"heal_batch": "2026-03-23_forensic"}'::jsonb),
  ('forensic_heal', 'manual_admin', 'package', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a', 'healed', 'integrity_report_null: reset integrity_check+auto_publish, unblocked', '{"heal_batch": "2026-03-23_forensic"}'::jsonb),
  ('forensic_heal', 'manual_admin', 'package', 'a9f19137-a004-4850-838a-bdc8f8a705f5', 'healed', 'integrity_report_null: reset integrity_check+auto_publish, unblocked', '{"heal_batch": "2026-03-23_forensic"}'::jsonb),
  ('forensic_heal', 'manual_admin', 'package', '570ccb3e-2937-4d81-b3d8-624b9be84737', 'healed', 'validate_learning_content stuck after cascade_reset: re-dispatched + downstream reset', '{"heal_batch": "2026-03-23_forensic"}'::jsonb);
