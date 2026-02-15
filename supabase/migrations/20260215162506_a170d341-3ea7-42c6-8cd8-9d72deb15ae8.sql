
-- ═══════════════════════════════════════════════════════════════════
-- auto_ops_cycle: Consolidates all manual admin actions into one
-- automated sweep. Replaces manual "Retry Failed" + "Recover Stuck".
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.auto_ops_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failed_retried int := 0;
  v_stuck_recovered int := 0;
  v_stale_cancelled int := 0;
  v_orphan_requeued int := 0;
BEGIN
  -- 1) RETRY FAILED JOBS (max 50 per cycle, only retryable ones)
  WITH retryable AS (
    SELECT id FROM public.job_queue
    WHERE status = 'failed'
      AND attempts < max_attempts
      AND updated_at < now() - interval '2 minutes'  -- don't retry immediately
    ORDER BY priority DESC, updated_at ASC
    LIMIT 50
  )
  UPDATE public.job_queue j
  SET status = 'pending',
      run_after = now() + interval '30 seconds',
      locked_at = NULL,
      locked_by = NULL,
      error = COALESCE(j.error, '') || ' | AUTO_RETRY_CYCLE',
      updated_at = now()
  FROM retryable r WHERE j.id = r.id;
  GET DIAGNOSTICS v_failed_retried = ROW_COUNT;

  -- 2) RECOVER STUCK PROCESSING (>10 min without progress)
  WITH stuck AS (
    SELECT id FROM public.job_queue
    WHERE status = 'processing'
      AND locked_at < now() - interval '10 minutes'
    LIMIT 50
  )
  UPDATE public.job_queue j
  SET status = 'pending',
      run_after = now() + interval '30 seconds',
      locked_at = NULL,
      locked_by = NULL,
      error = COALESCE(j.error, '') || ' | AUTO_STUCK_RECOVERY',
      updated_at = now()
  FROM stuck s WHERE j.id = s.id;
  GET DIAGNOSTICS v_stuck_recovered = ROW_COUNT;

  -- 3) CANCEL STALE COMPLETED/DUPLICATE JOBS (older than 24h, reduce noise)
  WITH stale AS (
    SELECT id FROM public.job_queue
    WHERE status IN ('completed', 'cancelled', 'skipped')
      AND updated_at < now() - interval '7 days'
    LIMIT 500
  )
  DELETE FROM public.job_queue j
  USING stale s WHERE j.id = s.id;
  GET DIAGNOSTICS v_stale_cancelled = ROW_COUNT;

  -- 4) RE-QUEUE ORPHANED BUILDING PACKAGES
  -- (packages stuck in 'building' with zero active jobs for >30 min)
  WITH orphans AS (
    SELECT cp.id
    FROM public.course_packages cp
    WHERE cp.status = 'building'
      AND cp.updated_at < now() - interval '30 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.status IN ('pending', 'processing')
          AND (jq.payload->>'package_id')::uuid = cp.id
      )
    LIMIT 10
  )
  UPDATE public.course_packages cp
  SET status = 'queued',
      stuck_reason = 'auto_ops_cycle: orphan recovery',
      updated_at = now()
  FROM orphans o WHERE cp.id = o.id;
  GET DIAGNOSTICS v_orphan_requeued = ROW_COUNT;

  -- 5) LOG the cycle
  INSERT INTO public.auto_heal_log (
    action_type, trigger_source, result_status, result_detail, metadata
  ) VALUES (
    'auto_ops_cycle', 'pg_cron',
    CASE WHEN (v_failed_retried + v_stuck_recovered + v_orphan_requeued) > 0
         THEN 'healed' ELSE 'noop' END,
    format('retried=%s stuck=%s cleaned=%s orphans=%s',
           v_failed_retried, v_stuck_recovered, v_stale_cancelled, v_orphan_requeued),
    jsonb_build_object(
      'failed_retried', v_failed_retried,
      'stuck_recovered', v_stuck_recovered,
      'stale_cleaned', v_stale_cancelled,
      'orphan_requeued', v_orphan_requeued,
      'ts', now()
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'failed_retried', v_failed_retried,
    'stuck_recovered', v_stuck_recovered,
    'stale_cleaned', v_stale_cancelled,
    'orphan_requeued', v_orphan_requeued
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- CRON SCHEDULES: Full autonomous ops
-- ═══════════════════════════════════════════════════════════════════

-- 1) Auto-Ops Cycle: every 5 minutes (retry failed, recover stuck, clean)
SELECT cron.schedule(
  'auto-ops-cycle',
  '*/5 * * * *',
  $$SELECT public.auto_ops_cycle();$$
);

-- 2) Production Watchdog: every 3 minutes (stale processing, orphan builds,
--    fan-out sync, batch loop cap, budget alerts)
SELECT cron.schedule(
  'production-watchdog',
  '*/3 * * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/production-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );$$
);

-- 3) Stuck Scan: every 10 minutes (heartbeat timeout, orphan detection)
SELECT cron.schedule(
  'stuck-scan',
  '*/10 * * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/stuck-scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );$$
);

-- 4) Ops Auto-Healer: every 15 minutes (diagnose + auto-heal full sweep)
SELECT cron.schedule(
  'ops-auto-healer',
  '*/15 * * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/ops-auto-healer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"mode":"auto"}'::jsonb
  );$$
);

-- 5) Pipeline Watchdog: every 5 minutes (stale steps, lease expiry, stall detection)
SELECT cron.schedule(
  'pipeline-watchdog',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/pipeline-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );$$
);
