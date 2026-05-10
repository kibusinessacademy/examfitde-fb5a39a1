-- Alert: rising protected-skip rate from ops_cancel_pending_non_building_jobs
-- Signals re-emerging policy race (new repair job_type without exempt flag)
-- Rollback: SELECT cron.unschedule('ops-cancel-skip-rise-alert-10min'); DROP FUNCTION public.fn_alert_ops_cancel_skip_rise();

CREATE OR REPLACE FUNCTION public.fn_alert_ops_cancel_skip_rise()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_curr int := 0;
  v_prev int := 0;
  v_severity text := 'info';
  v_should_alert boolean := false;
  v_top_reasons jsonb;
BEGIN
  SELECT COUNT(*) INTO v_curr
  FROM auto_heal_log
  WHERE action_type = 'ops_cancel_pending_non_building_job_skipped'
    AND created_at > now() - interval '60 minutes';

  SELECT COUNT(*) INTO v_prev
  FROM auto_heal_log
  WHERE action_type = 'ops_cancel_pending_non_building_job_skipped'
    AND created_at > now() - interval '120 minutes'
    AND created_at <= now() - interval '60 minutes';

  -- Alert conditions
  IF v_curr >= 20 OR (v_curr >= 5 AND v_curr >= GREATEST(v_prev,1) * 3) THEN
    v_should_alert := true;
    v_severity := CASE WHEN v_curr >= 50 THEN 'crit' ELSE 'warn' END;
  END IF;

  IF v_should_alert THEN
    SELECT jsonb_agg(t) INTO v_top_reasons FROM (
      SELECT metadata->>'job_type' AS job_type,
             metadata->>'protect_reason' AS protect_reason,
             COUNT(*) AS n
      FROM auto_heal_log
      WHERE action_type = 'ops_cancel_pending_non_building_job_skipped'
        AND created_at > now() - interval '60 minutes'
      GROUP BY 1,2 ORDER BY 3 DESC LIMIT 5
    ) t;

    PERFORM public.ops_raise_alert(
      'OPS_CANCEL_SKIP_RISE',
      v_severity,
      format('Protected-skip cancels rising: %s/h (prev %s/h)', v_curr, v_prev),
      jsonb_build_object(
        'current_60m', v_curr,
        'previous_60m', v_prev,
        'multiplier', ROUND(v_curr::numeric / GREATEST(v_prev,1), 2),
        'top_reasons', COALESCE(v_top_reasons,'[]'::jsonb),
        'hint', 'Investigate new repair job_type: missing exempt_from_auto_cancel policy?'
      )
    );
  END IF;

  INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail, metadata)
  VALUES (
    'ops_cancel_skip_rise_check',
    'fn_alert_ops_cancel_skip_rise',
    'system',
    CASE WHEN v_should_alert THEN 'alerted' ELSE 'noop' END,
    format('curr=%s prev=%s severity=%s', v_curr, v_prev, v_severity),
    jsonb_build_object('current_60m', v_curr, 'previous_60m', v_prev, 'severity', v_severity, 'alerted', v_should_alert)
  );

  RETURN jsonb_build_object('current_60m', v_curr, 'previous_60m', v_prev, 'alerted', v_should_alert, 'severity', v_severity);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_alert_ops_cancel_skip_rise() FROM PUBLIC, anon, authenticated;

-- Cron: every 10 minutes
SELECT cron.schedule(
  'ops-cancel-skip-rise-alert-10min',
  '*/10 * * * *',
  $cron$ SELECT public.fn_alert_ops_cancel_skip_rise(); $cron$
);

-- Smoke
SELECT public.fn_alert_ops_cancel_skip_rise() AS smoke;