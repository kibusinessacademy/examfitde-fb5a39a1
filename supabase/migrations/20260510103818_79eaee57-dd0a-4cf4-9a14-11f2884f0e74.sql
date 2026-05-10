-- Fix: heal_alert_config column is alert_key (not key)
CREATE OR REPLACE FUNCTION public.fn_simulate_parity_cron_guard(p_scenario text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_threshold int;
  v_last_at timestamptz;
  v_status text;
  v_reason text;
BEGIN
  SELECT COALESCE(
    (SELECT threshold FROM heal_alert_config WHERE alert_key='parity_cron_stale_hours'),
    36
  ) INTO v_threshold;

  v_last_at := CASE p_scenario
    WHEN 'fresh'   THEN now() - interval '1 hour'
    WHEN 'late'    THEN now() - make_interval(hours => v_threshold + 6)
    WHEN 'missing' THEN NULL
    ELSE NULL
  END;

  IF v_last_at IS NULL THEN
    v_status := 'critical'; v_reason := 'no_recent_run';
  ELSIF v_last_at < now() - make_interval(hours => v_threshold) THEN
    v_status := 'warn'; v_reason := 'stale_run';
  ELSE
    v_status := 'ok'; v_reason := 'fresh';
  END IF;

  RETURN jsonb_build_object(
    'scenario', p_scenario, 'status', v_status, 'reason', v_reason,
    'threshold_hours', v_threshold, 'simulated_last_run_at', v_last_at);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_simulate_parity_cron_guard(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_simulate_parity_cron_guard(text) TO authenticated, service_role;

-- New: simulate the outbox effect of parity-cron-guard for fresh/late/missing
-- (pure compute — does NOT insert into heal_alert_notifications or auto_heal_log)
CREATE OR REPLACE FUNCTION public.fn_simulate_parity_cron_guard_outbox(p_scenario text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_eval jsonb;
  v_status text;
  v_severity text;
  v_should_enqueue boolean;
  v_alert_key text := 'parity_cron_health';
BEGIN
  v_eval := public.fn_simulate_parity_cron_guard(p_scenario);
  v_status := v_eval->>'status';

  v_should_enqueue := v_status IN ('warn','critical');
  v_severity := CASE v_status WHEN 'critical' THEN 'high' WHEN 'warn' THEN 'medium' ELSE 'info' END;

  RETURN jsonb_build_object(
    'evaluation', v_eval,
    'would_enqueue_notification', v_should_enqueue,
    'expected_severity', v_severity,
    'expected_alert_key', v_alert_key,
    'expected_status', CASE WHEN v_should_enqueue THEN 'pending' ELSE NULL END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.fn_simulate_parity_cron_guard_outbox(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_simulate_parity_cron_guard_outbox(text) TO authenticated, service_role;