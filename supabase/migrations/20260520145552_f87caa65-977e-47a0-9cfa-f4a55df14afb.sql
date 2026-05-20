-- Forensik 2026-05-20: Terminierung von 5 PRE_HEARTBEAT_KILL_TERMINAL-Zombies,
-- die seit 2026-05-15 durch T21-Auto-Heal alle paar Stunden re-queued + getötet wurden.
-- T21 ist in derselben Welle gehärtet — diese Migration räumt die Altlasten ab.

WITH cancelled AS (
  UPDATE public.job_queue
     SET status = 'cancelled',
         locked_at = NULL,
         locked_by = NULL,
         updated_at = now(),
         last_error_code = 'PRE_HEARTBEAT_KILL_TERMINAL',
         last_error = 'Forensik 2026-05-20: terminal zombie cancelled (T21 hardened)',
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
           'forensic_cancel_at', to_jsonb(now()),
           'forensic_reason', 'pre_heartbeat_kill_terminal_loop'
         )
   WHERE last_error_code = 'PRE_HEARTBEAT_KILL_TERMINAL'
     AND status = 'failed'
     AND attempts <= 3
     AND updated_at > now() - interval '7 days'
   RETURNING id, package_id, job_type
)
INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
SELECT 'phk_terminal_zombie_cancel', 'package', package_id, 'cancelled',
       jsonb_build_object('job_id', id, 'job_type', job_type, 'forensic_batch', '2026-05-20')
  FROM cancelled;