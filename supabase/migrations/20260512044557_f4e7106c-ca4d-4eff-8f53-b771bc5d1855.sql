CREATE OR REPLACE FUNCTION public.admin_get_queue_throughput_v2(p_window_hours integer DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_base jsonb;
  v_pending_p50 numeric;
  v_pending_p95 numeric;
  v_pending_claimable int;
  v_pending_deferred int;
  v_pending_terminal int;
  v_pending_oldest_created_sec numeric;
  v_processing_oldest_sec numeric;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'unauthorized: admin required';
  END IF;

  v_base := public.admin_get_queue_throughput(p_window_hours);

  -- Effective wait: only jobs that are claimable RIGHT NOW and not terminal
  SELECT
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (now() - GREATEST(created_at, COALESCE(run_after, created_at)))))::numeric, 1),
    round(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (now() - GREATEST(created_at, COALESCE(run_after, created_at)))))::numeric, 1)
  INTO v_pending_p50, v_pending_p95
  FROM public.job_queue
  WHERE status IN ('pending','queued')
    AND (run_after IS NULL OR run_after <= now())
    AND COALESCE(meta->>'admin_terminal','false') <> 'true';

  -- Bookkeeping counters for transparency
  SELECT
    COUNT(*) FILTER (WHERE (run_after IS NULL OR run_after <= now()) AND COALESCE(meta->>'admin_terminal','false') <> 'true'),
    COUNT(*) FILTER (WHERE run_after IS NOT NULL AND run_after > now()),
    COUNT(*) FILTER (WHERE COALESCE(meta->>'admin_terminal','false') = 'true'),
    round(EXTRACT(EPOCH FROM (now() - MIN(created_at)))::numeric, 1)
  INTO v_pending_claimable, v_pending_deferred, v_pending_terminal, v_pending_oldest_created_sec
  FROM public.job_queue
  WHERE status IN ('pending','queued');

  SELECT round(EXTRACT(EPOCH FROM (now() - MIN(COALESCE(last_heartbeat_at, locked_at, started_at, created_at))))::numeric, 1)
  INTO v_processing_oldest_sec
  FROM public.job_queue WHERE status = 'processing';

  RETURN v_base
    || jsonb_build_object(
      'pending_wait_p50_sec', COALESCE(v_pending_p50, 0),
      'pending_wait_p95_sec', COALESCE(v_pending_p95, 0),
      'pending_claimable_now', COALESCE(v_pending_claimable, 0),
      'pending_deferred_future', COALESCE(v_pending_deferred, 0),
      'pending_admin_terminal', COALESCE(v_pending_terminal, 0),
      'pending_oldest_created_sec', COALESCE(v_pending_oldest_created_sec, 0),
      'processing_oldest_sec', COALESCE(v_processing_oldest_sec, 0),
      'metric_definition', 'effective_wait = now() - GREATEST(created_at, run_after); only claimable & non-terminal'
    );
END;
$function$;