
-- OPS.ALERT.SEVERITY.NORMALIZE.1
-- Normalize legacy 'crit' literal to canonical 'critical' to satisfy
-- public.ops_alert_events_severity_check CHECK (severity IN ('info','warn','critical')).
-- Affects two SECURITY DEFINER functions; no behavior change beyond label.

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

  IF v_curr >= 20 OR (v_curr >= 5 AND v_curr >= GREATEST(v_prev,1) * 3) THEN
    v_should_alert := true;
    -- NORMALIZE: 'crit' → 'critical' (matches ops_alert_events_severity_check)
    v_severity := CASE WHEN v_curr >= 50 THEN 'critical' ELSE 'warn' END;
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

CREATE OR REPLACE FUNCTION public.fn_detect_funnel_event_loss()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_meta jsonb;
BEGIN
  SELECT * INTO v_row FROM public.v_funnel_event_loss;

  v_meta := jsonb_build_object(
    'paid_orders_24h',           v_row.paid_orders_24h,
    'checkout_complete_24h',     v_row.checkout_complete_24h,
    'checkout_started_24h',      v_row.checkout_started_24h,
    'pricing_view_24h',          v_row.pricing_view_24h,
    'parity_pct',                v_row.checkout_complete_parity_pct,
    'status',                    v_row.status,
    'pricing_view_drought',      v_row.pricing_view_drought
  );

  INSERT INTO public.auto_heal_log
    (action_type, trigger_source, target_type, result_status, metadata)
  VALUES
    ('funnel_event_loss_detection',
     'cron_funnel_loss_detect_hourly',
     'system',
     CASE v_row.status
       WHEN 'CRIT' THEN 'critical'  -- NORMALIZE: 'crit' → 'critical'
       WHEN 'WARN' THEN 'warn'
       WHEN 'OK'   THEN 'success'
       ELSE 'noop'
     END,
     v_meta);

  RETURN v_meta;
END;
$function$;

-- Audit trail
INSERT INTO public.auto_heal_log
  (action_type, trigger_source, target_type, result_status, result_detail, metadata)
VALUES
  ('ops_alert_severity_normalize',
   'OPS.ALERT.SEVERITY.NORMALIZE.1',
   'system',
   'success',
   'Normalized legacy crit → critical in fn_alert_ops_cancel_skip_rise + fn_detect_funnel_event_loss',
   jsonb_build_object(
     'functions', jsonb_build_array('fn_alert_ops_cancel_skip_rise','fn_detect_funnel_event_loss'),
     'canonical_severities', jsonb_build_array('info','warn','critical')
   ));
