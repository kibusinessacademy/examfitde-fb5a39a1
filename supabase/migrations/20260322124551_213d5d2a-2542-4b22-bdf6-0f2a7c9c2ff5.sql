
-- ══════════════════════════════════════════════════════════════════════
-- Targeted Heal: 3 Stale Gate Anomalies (2026-03-22)
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Elektroniker GSI (1f3fe84a): Final re-heal after loop-guard deploy ──
-- Unblock package
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL
WHERE id = '1f3fe84a-30a0-40cc-8f36-a7f5678bd285'
  AND status = 'blocked';

-- Reset step with loop_guard_reset_at to prevent re-block from historical jobs
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL,
    meta = jsonb_build_object(
      'loop_guard_reset_at', now()::text,
      'heal_reason', 'admin_re_heal_after_loop_guard_deploy',
      'healed_at', now()::text,
      'zero_progress_runs', 0,
      'zero_generation_streak', 0
    )
WHERE package_id = '1f3fe84a-30a0-40cc-8f36-a7f5678bd285'
  AND step_key = 'generate_learning_content'
  AND status = 'blocked';

-- ── 2. Steuerfachangestellter (a9f19137): Integrity passed but flag stale ──
-- The integrity step is done with score=100, but package flag wasn't propagated.
-- Fix: set integrity_passed=true, unblock package, reset auto_publish to queued
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL,
    integrity_passed = true
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND status = 'blocked';

UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL,
    meta = meta || jsonb_build_object(
      'heal_reason', 'stale_gate_flag_fix_integrity_passed_not_propagated',
      'healed_at', now()::text,
      'auto_publish_cancel_count', 0
    )
WHERE package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND step_key = 'auto_publish';

-- ── 3. Elektroniker Betriebstechnik (fd1d8192): Stale integrity_passed=true ──
-- integrity step was cascade-reset but package flag stayed true. 
-- Fix: clear stale flag, let integrity re-run naturally
UPDATE course_packages
SET integrity_passed = false,
    status = 'building'
WHERE id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  AND integrity_passed = true;

-- Reset auto_publish step which has old block state
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL,
    meta = meta || jsonb_build_object(
      'heal_reason', 'stale_flag_cascade_reset_fix',
      'healed_at', now()::text,
      'auto_publish_cancel_count', 0
    )
WHERE package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  AND step_key = 'auto_publish';

-- ── Audit trail ──
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
VALUES
  ('stale_gate_heal', 'admin_forensic', 'package', '1f3fe84a-30a0-40cc-8f36-a7f5678bd285', 'healed', 'Elektroniker GSI: loop guard re-heal after deploy with reset_at window', '{"step":"generate_learning_content","heal_type":"loop_guard_resume"}'::jsonb),
  ('stale_gate_heal', 'admin_forensic', 'package', 'a9f19137-a004-4850-838a-bdc8f8a705f5', 'healed', 'Steuerfachangestellter: integrity_passed flag not propagated despite score=100', '{"step":"auto_publish","heal_type":"stale_flag_propagation"}'::jsonb),
  ('stale_gate_heal', 'admin_forensic', 'package', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a', 'healed', 'Elektroniker Betriebstechnik: stale integrity_passed=true after cascade reset', '{"step":"run_integrity_check","heal_type":"stale_flag_clear"}'::jsonb);
