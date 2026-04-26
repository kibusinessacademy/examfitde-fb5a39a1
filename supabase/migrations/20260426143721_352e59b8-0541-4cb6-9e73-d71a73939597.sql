-- PART 1: is_published Drift fix
UPDATE public.course_packages
SET is_published = true, updated_at = now()
WHERE status = 'published'
  AND published_at IS NOT NULL
  AND COALESCE(is_published, false) = false;

-- PART 2a: Straßenbauer/-in
UPDATE public.course_packages
SET manual_heal_cooldown_until = NULL,
    stuck_reason = NULL, blocked_reason = NULL, last_error = NULL,
    retry_count = 0, updated_at = now()
WHERE id = 'acecaa35-05cd-4e5b-a81c-a608773ed6b9';

-- PART 2b: Automobilkaufmann/-frau
UPDATE public.course_packages
SET status = 'building', blocked_reason = NULL, stuck_reason = NULL,
    last_error = NULL, retry_count = 0, manual_heal_cooldown_until = NULL,
    last_progress_at = now(), updated_at = now()
WHERE id = '52cc076a-13ba-4f73-8202-b3f1164bba0f';

UPDATE public.package_steps
SET status = 'queued', last_error = NULL, attempts = 0,
    meta = COALESCE(meta, '{}'::jsonb)
           - 'frozen_until' - 'hot_loop_cycles'
           - 'last_repair_action' - 'exhaustion_state'
           || jsonb_build_object('manual_reset_at', now(),
                                 'manual_reset_reason', 'auto_repair_limit_manual_clear'),
    updated_at = now()
WHERE package_id = '52cc076a-13ba-4f73-8202-b3f1164bba0f'
  AND step_key IN ('run_integrity_check','quality_council','auto_publish');

-- PART 2c: Maler und Lackierer/-in
UPDATE public.course_packages
SET stuck_reason = NULL, last_error = NULL, retry_count = 0,
    manual_heal_cooldown_until = NULL, last_progress_at = now(), updated_at = now()
WHERE id = 'b77d271d-7815-4a5d-9643-7de31df83953';

UPDATE public.package_steps
SET status = 'queued', last_error = NULL, attempts = 0,
    meta = COALESCE(meta, '{}'::jsonb)
           - 'last_repair_action' - 'exhaustion_state'
           - 'repair_cycle_count' - 'awaiting_delta_since'
           || jsonb_build_object('manual_reset_at', now(),
                                 'manual_reset_reason', 'auto_repair_limit_manual_clear'),
    updated_at = now()
WHERE package_id = 'b77d271d-7815-4a5d-9643-7de31df83953'
  AND step_key IN ('quality_council','auto_publish');

-- PART 3: Audit-Log (korrekte Spalten: heal_type, details)
INSERT INTO public.system_heal_log(package_id, heal_type, details, created_at)
SELECT id,
       'manual_auto_repair_limit_clear',
       jsonb_build_object(
         'reason', 'Operator hat Auto-Repair-Limit-Exhaustion manuell zurückgesetzt (Cockpit)',
         'cleared_fields', array['stuck_reason','blocked_reason','last_error','manual_heal_cooldown_until','retry_count'],
         'requeued_steps', array['run_integrity_check','quality_council','auto_publish']),
       now()
FROM public.course_packages
WHERE id IN ('52cc076a-13ba-4f73-8202-b3f1164bba0f',
             'acecaa35-05cd-4e5b-a81c-a608773ed6b9',
             'b77d271d-7815-4a5d-9643-7de31df83953');