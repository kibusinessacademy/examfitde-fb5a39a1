
-- HEAL 1: Steuerfachangestellte (a9f19137) — auto_publish still blocked after previous heal
-- Root: quality_council=done, integrity=done, but auto_publish loop guard still active
-- Fix: reset auto_publish to queued, clear loop guard, unblock package

UPDATE public.package_steps
SET status = 'queued',
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb)
           - 'blocked_at' - 'last_gate_state' - 'auto_publish_block_reason' - 'auto_publish_cancel_count'
           || jsonb_build_object('healed_at_v2', now()::text, 'heal_reason_v2', 'auto_publish_loop_guard_stale_after_council_integrity_done')
WHERE package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND step_key = 'auto_publish';

UPDATE public.course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5';

-- HEAL 2: Fachkraft Metalltechnik (fdf4c23c) — validate_learning_content stuck after cascade reset
-- Content generation is done, but validate step stuck in queued with no job dispatched (TRUE_STALL)
-- Cancel stale pending job for build_ai_tutor_index (premature - prereqs not met)

UPDATE public.job_queue
SET status = 'cancelled', last_error = 'heal: prereq not met, cancelled stale pending job'
WHERE package_id = 'fdf4c23c-be16-43ed-ac0e-aea0ab64665f'
  AND job_type = 'package_build_ai_tutor_index'
  AND status = 'pending';

-- Audit log
INSERT INTO public.admin_actions (action, scope, affected_ids, payload)
VALUES (
  'heal_steuerfach_auto_publish_v2_and_metalltechnik_validate_stall',
  'package',
  ARRAY['a9f19137-a004-4850-838a-bdc8f8a705f5', 'fdf4c23c-be16-43ed-ac0e-aea0ab64665f'],
  '{"fixes":[{"pkg":"a9f19137","issue":"auto_publish blocked by stale loop guard despite council+integrity done","fix":"reset auto_publish to queued, unblock package"},{"pkg":"fdf4c23c","issue":"validate_learning_content TRUE_STALL after cascade reset, stale tutor_index job premature","fix":"cancelled stale job, auto-heal will re-dispatch validate step"}]}'::jsonb
);
