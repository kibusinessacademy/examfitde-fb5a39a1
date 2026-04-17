-- Manuell entblockieren: nur Jobs zurücksetzen, Paketstatus unverändert (WIP-Cap respektieren)

-- 1. Failed Jobs (letzte 7 Tage) zurück auf pending
WITH reset_failed AS (
  UPDATE public.job_queue
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      run_after = now() + (random() * interval '15 seconds'),
      attempts = LEAST(attempts, 1),
      last_error = NULL,
      last_error_code = NULL,
      last_error_severity = NULL,
      rate_limited_until = NULL
  WHERE status = 'failed'
    AND created_at > now() - interval '7 days'
  RETURNING id, job_type, package_id
),
-- 2. Stale processing Jobs (>10min lock) auch zurücksetzen
reset_stale AS (
  UPDATE public.job_queue
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      run_after = now() + interval '5 seconds'
  WHERE status = 'processing'
    AND locked_at < now() - interval '10 minutes'
  RETURNING id, job_type, package_id
)
INSERT INTO public.admin_actions (action, scope, payload)
SELECT
  'manual_unblock_all_pending_failed',
  'pipeline',
  jsonb_build_object(
    'reason', 'manual_bypass_runner_optimization',
    'failed_reset', (SELECT count(*) FROM reset_failed),
    'stale_reset', (SELECT count(*) FROM reset_stale),
    'failed_by_type', (SELECT jsonb_object_agg(job_type, c) FROM (SELECT job_type, count(*) c FROM reset_failed GROUP BY job_type) t),
    'timestamp', now()
  );