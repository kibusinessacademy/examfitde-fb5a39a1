-- Notification Delivery Health: detects systemic delivery failures (missing secrets, broken webhooks)

CREATE OR REPLACE FUNCTION public.fn_check_notification_delivery_health(p_window_minutes int DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz := now() - make_interval(mins => p_window_minutes);
  v_total int;
  v_sent int;
  v_skipped int;
  v_failed int;
  v_pending int;
  v_skipped_pct numeric;
  v_failed_pct numeric;
  v_oldest_pending_age_min int;
  v_skipped_reasons jsonb;
  v_failed_reasons jsonb;
  v_destinations_total int;
  v_destinations_enabled int;
  v_status text;
  v_issues jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE status='sent'),
         count(*) FILTER (WHERE status='skipped'),
         count(*) FILTER (WHERE status='failed'),
         count(*) FILTER (WHERE status='pending'),
         COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status='pending')))/60, 0)::int
    INTO v_total, v_sent, v_skipped, v_failed, v_pending, v_oldest_pending_age_min
    FROM heal_alert_notifications
   WHERE created_at >= v_window;

  SELECT jsonb_object_agg(reason, c) FROM (
    SELECT COALESCE(error->>'reason', error->>'message', 'unknown') reason, count(*) c
      FROM heal_alert_notifications
     WHERE created_at >= v_window AND status='skipped'
     GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  ) s INTO v_skipped_reasons;

  SELECT jsonb_object_agg(reason, c) FROM (
    SELECT COALESCE(error->>'reason', error->>'message', 'unknown') reason, count(*) c
      FROM heal_alert_notifications
     WHERE created_at >= v_window AND status='failed'
     GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  ) s INTO v_failed_reasons;

  SELECT count(*), count(*) FILTER (WHERE enabled=true)
    INTO v_destinations_total, v_destinations_enabled
    FROM heal_alert_destinations;

  v_skipped_pct := CASE WHEN v_total > 0 THEN round(100.0 * v_skipped / v_total, 1) ELSE 0 END;
  v_failed_pct  := CASE WHEN v_total > 0 THEN round(100.0 * v_failed  / v_total, 1) ELSE 0 END;

  IF v_destinations_enabled = 0 AND v_total > 0 THEN
    v_issues := v_issues || jsonb_build_object('code','no_enabled_destinations','severity','high',
      'message','Alerts queued but no enabled destinations configured');
  END IF;
  IF v_skipped_pct >= 80 AND v_total >= 3 THEN
    v_issues := v_issues || jsonb_build_object('code','high_skip_rate','severity','high',
      'message','>=80% of notifications skipped (likely missing secrets)','reasons',v_skipped_reasons);
  END IF;
  IF v_failed_pct >= 50 AND v_total >= 3 THEN
    v_issues := v_issues || jsonb_build_object('code','high_failure_rate','severity','critical',
      'message','>=50% of notifications failed (webhook/transport broken)','reasons',v_failed_reasons);
  END IF;
  IF v_oldest_pending_age_min > 30 THEN
    v_issues := v_issues || jsonb_build_object('code','stale_pending','severity','high',
      'message','Pending notifications older than 30min (dispatcher cron stalled?)',
      'oldest_pending_age_min', v_oldest_pending_age_min);
  END IF;

  v_status := CASE
    WHEN jsonb_array_length(v_issues) = 0 THEN 'healthy'
    WHEN v_issues @> '[{"severity":"critical"}]'::jsonb THEN 'critical'
    ELSE 'degraded'
  END;

  v_result := jsonb_build_object(
    'status', v_status,
    'window_minutes', p_window_minutes,
    'totals', jsonb_build_object('total',v_total,'sent',v_sent,'skipped',v_skipped,
                                 'failed',v_failed,'pending',v_pending,
                                 'skipped_pct',v_skipped_pct,'failed_pct',v_failed_pct,
                                 'oldest_pending_age_min',v_oldest_pending_age_min),
    'destinations', jsonb_build_object('total',v_destinations_total,'enabled',v_destinations_enabled),
    'skipped_reasons', COALESCE(v_skipped_reasons,'{}'::jsonb),
    'failed_reasons',  COALESCE(v_failed_reasons,'{}'::jsonb),
    'issues', v_issues,
    'checked_at', now()
  );

  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES ('notification_delivery_health', 'system',
          CASE WHEN v_status='healthy' THEN 'ok' ELSE 'warn' END,
          v_status, v_result);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_notification_delivery_health(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_notification_delivery_health(int) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_notification_delivery_health(p_window_minutes int DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  RETURN public.fn_check_notification_delivery_health(p_window_minutes);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_notification_delivery_health(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_notification_delivery_health(int) TO authenticated;

-- Cron: hourly check
DO $$
BEGIN
  PERFORM cron.unschedule('notification-delivery-health-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'notification-delivery-health-hourly',
  '23 * * * *',
  $cron$ SELECT public.fn_check_notification_delivery_health(60); $cron$
);

-- Test helper: allow CI/regression to assert parity-cron-guard behavior on synthetic states
CREATE OR REPLACE FUNCTION public.fn_simulate_parity_cron_guard(p_scenario text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_threshold int;
  v_last_at timestamptz;
  v_status text;
  v_reason text;
BEGIN
  SELECT COALESCE((SELECT threshold FROM heal_alert_config WHERE key='parity_cron_stale_hours'), 36) INTO v_threshold;

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