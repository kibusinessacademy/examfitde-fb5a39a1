-- ─────────────────────────────────────────────────────────────────────────────
-- Fix 1: admin_get_lane_health RPC (SECURITY DEFINER + has_role gate)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_lane_health()
RETURNS SETOF public.v_admin_lane_health
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY SELECT * FROM public.v_admin_lane_health;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_lane_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_lane_health() TO authenticated;

-- Lock down the underlying view (defense in depth)
REVOKE ALL ON public.v_admin_lane_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_lane_health TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fix 3: Reaper Anti-Loop — count reaps per job in meta, fail after threshold
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_reap_stale_processing_jobs(p_stale_minutes integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_requeued int := 0;
  v_failed int := 0;
  v_loop_killed int := 0;
  v_cutoff timestamptz;
  v_max_reaps int := 2;  -- nach 2 Reaps ist es klar ein Loop
BEGIN
  v_cutoff := now() - (p_stale_minutes || ' minutes')::interval;

  -- a) Loop-Detection: bereits >= v_max_reaps Reaps → hart auf failed
  WITH loop_jobs AS (
    SELECT id
    FROM public.job_queue
    WHERE status = 'processing'
      AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
      AND COALESCE((meta->>'stale_reap_count')::int, 0) >= v_max_reaps
    FOR UPDATE SKIP LOCKED
  ),
  upd_loop AS (
    UPDATE public.job_queue jq
    SET status = 'failed',
        completed_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        liveness_status = 'killed',
        last_error = 'STALE_REAP_LOOP_TERMINAL: reaped >= ' || v_max_reaps || ' times without progress',
        last_error_code = 'STALE_REAP_LOOP_TERMINAL',
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'stale_reap_terminal_at', to_jsonb(now()),
          'stale_reap_count', COALESCE((meta->>'stale_reap_count')::int, 0) + 1
        ),
        updated_at = now()
    FROM loop_jobs lj
    WHERE jq.id = lj.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_loop_killed FROM upd_loop;

  -- b) Versuchszahl noch unter max + reap_count < v_max_reaps → requeue mit ↑ counter
  WITH stale AS (
    SELECT id, COALESCE((meta->>'stale_reap_count')::int, 0) AS reap_count
    FROM public.job_queue
    WHERE status = 'processing'
      AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
      AND COALESCE(attempts, 0) < COALESCE(max_attempts, 25)
      AND COALESCE((meta->>'stale_reap_count')::int, 0) < v_max_reaps
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.job_queue jq
    SET status = 'pending',
        locked_at = NULL,
        locked_by = NULL,
        last_heartbeat_at = NULL,
        liveness_status = 'suspect',
        last_error = 'STALE_PROCESSING_REAPED: heartbeat older than ' || p_stale_minutes || 'min — auto-requeued (reap #' || (s.reap_count + 1) || ')',
        last_error_code = 'STALE_PROCESSING_REAPED',
        run_after = now() + interval '60 seconds',
        meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
          'stale_reap_count', s.reap_count + 1,
          'last_stale_reap_at', to_jsonb(now())
        ),
        updated_at = now()
    FROM stale s
    WHERE jq.id = s.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_requeued FROM upd;

  -- c) attempts >= max → failed (clean)
  WITH stale_exhausted AS (
    SELECT id
    FROM public.job_queue
    WHERE status = 'processing'
      AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
      AND COALESCE(attempts, 0) >= COALESCE(max_attempts, 25)
    FOR UPDATE SKIP LOCKED
  ),
  upd2 AS (
    UPDATE public.job_queue jq
    SET status = 'failed',
        completed_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        liveness_status = 'killed',
        last_error = 'STALE_PROCESSING_EXHAUSTED: heartbeat lost AND max_attempts reached',
        last_error_code = 'STALE_PROCESSING_EXHAUSTED',
        updated_at = now()
    FROM stale_exhausted s
    WHERE jq.id = s.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_failed FROM upd2;

  IF v_requeued > 0 OR v_failed > 0 OR v_loop_killed > 0 THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, result_status, result_detail, metadata)
    VALUES ('reap_stale_processing','cron','applied',
            format('Reaped %s stale jobs (requeued=%s, exhausted=%s, loop_killed=%s)',
                   v_requeued + v_failed + v_loop_killed, v_requeued, v_failed, v_loop_killed),
            jsonb_build_object('requeued',v_requeued,'failed',v_failed,'loop_killed',v_loop_killed,
                               'stale_minutes',p_stale_minutes,'max_reaps',v_max_reaps));
  END IF;

  RETURN jsonb_build_object('ok',true,'requeued',v_requeued,'failed',v_failed,'loop_killed',v_loop_killed,
                            'stale_minutes',p_stale_minutes,'max_reaps',v_max_reaps);
END;
$function$;

-- Sofort-Sweep: existierende Loop-Jobs (>2 reaps) kompromisslos auf failed
-- (führt der nächste Cron-Tick eh auch aus, aber 1× explizit für Demo)
DO $$
DECLARE r jsonb;
BEGIN
  r := public.fn_reap_stale_processing_jobs(10);
  RAISE NOTICE 'Initial sweep result: %', r;
END $$;