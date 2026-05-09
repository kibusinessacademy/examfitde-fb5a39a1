
-- Track D: Auto-Pulse Verification

CREATE OR REPLACE FUNCTION public.fn_auto_recovery_pulse_decide_dryrun()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pending int;
  v_oldest_min int;
  v_failed_15m int;
  v_total_15m int;
  v_failure_rate numeric;
  v_reaper_churn int;
  v_gate jsonb;
  v_burst int;
  v_decision text;
BEGIN
  SELECT COUNT(*)::int,
         COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)))/60,0)::int
    INTO v_pending, v_oldest_min
    FROM public.job_queue
   WHERE status='pending'
     AND (run_after IS NULL OR run_after <= now())
     AND COALESCE(worker_pool,'default')='default';

  SELECT COUNT(*) FILTER (WHERE status='failed')::int, COUNT(*)::int
    INTO v_failed_15m, v_total_15m
    FROM public.job_queue
   WHERE COALESCE(completed_at, updated_at) > now() - interval '15 minutes';

  v_failure_rate := CASE WHEN v_total_15m>0 THEN v_failed_15m::numeric/v_total_15m ELSE 0 END;

  SELECT COUNT(*)::int INTO v_reaper_churn
    FROM public.auto_heal_log
   WHERE action_type IN ('reap_stale_processing_job','stale_reap')
     AND created_at > now() - interval '5 minutes';

  v_gate := public.fn_worker_health_gate();
  v_burst := public.fn_adaptive_burst_size_v2(v_pending, v_failure_rate, v_reaper_churn, NULL, 'default');

  IF v_pending <= 100 THEN v_decision := 'noop_below_threshold';
  ELSIF v_oldest_min < 10 THEN v_decision := 'noop_oldest_under_10min';
  ELSIF NOT (v_gate->>'healthy')::boolean THEN v_decision := 'noop_gate_unhealthy';
  ELSIF v_failure_rate > 0.30 THEN v_decision := 'noop_failure_rate_too_high';
  ELSE v_decision := 'would_pulse';
  END IF;

  RETURN jsonb_build_object(
    'dry_run', true,
    'decision', v_decision,
    'pending', v_pending,
    'oldest_min', v_oldest_min,
    'failure_rate_15m', v_failure_rate,
    'reaper_churn_5m', v_reaper_churn,
    'burst_size', v_burst,
    'gate', v_gate
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_auto_recovery_pulse_decide_dryrun() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auto_recovery_pulse_decide_dryrun() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_smoke_auto_recovery_pulse()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN public.fn_auto_recovery_pulse_decide_dryrun();
END $$;

GRANT EXECUTE ON FUNCTION public.admin_smoke_auto_recovery_pulse() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_auto_recovery_pulse_health(p_window_hours int DEFAULT 24)
RETURNS TABLE(
  decision text,
  decisions_count int,
  pulsed_jobs_total int,
  avg_burst_size numeric,
  avg_oldest_min numeric,
  avg_pending numeric,
  last_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY
    SELECT
      (l.metadata->>'decision')::text AS decision,
      COUNT(*)::int AS decisions_count,
      COALESCE(SUM((l.metadata->>'pulsed')::int),0)::int AS pulsed_jobs_total,
      ROUND(AVG((l.metadata->>'burst_size')::numeric),1) AS avg_burst_size,
      ROUND(AVG((l.metadata->>'oldest_min')::numeric),1) AS avg_oldest_min,
      ROUND(AVG((l.metadata->>'pending')::numeric),1) AS avg_pending,
      MAX(l.created_at) AS last_at
    FROM public.auto_heal_log l
    WHERE l.action_type='auto_recovery_pulse_decide'
      AND l.created_at > now() - (p_window_hours || ' hours')::interval
    GROUP BY (l.metadata->>'decision')
    ORDER BY decisions_count DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_get_auto_recovery_pulse_health(int) TO authenticated;
