
-- Heal Steuerfachangestellter/-in (a9f19137)
-- Root cause: quality_council marked done but 7 sessions still pending, integrity_passed=false

-- 1. Reset quality_council + run_integrity_check + auto_publish steps
UPDATE public.package_steps
SET status = 'queued',
    meta = COALESCE(meta, '{}'::jsonb)
           - 'loop_guard_blocked' - 'loop_guard_reason' - 'loop_guard_at'
           || jsonb_build_object('healed_at', now()::text, 'heal_reason', 'council_sessions_pending_despite_step_done')
WHERE package_id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND step_key IN ('quality_council', 'run_integrity_check', 'auto_publish');

-- 2. Unblock package: status -> building, clear blocked_reason
UPDATE public.course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5';

-- 3. Audit log
INSERT INTO public.admin_actions (action, scope, affected_ids, payload)
VALUES (
  'heal_steuerfach_auto_publish_blocked',
  'package',
  ARRAY['a9f19137-a004-4850-838a-bdc8f8a705f5'],
  '{"reason":"quality_council step done but 7 sessions pending, integrity_passed=false, auto_publish loop guard blocked after 5 failures","fix":"reset quality_council+integrity+auto_publish to queued, unblock package"}'::jsonb
);
