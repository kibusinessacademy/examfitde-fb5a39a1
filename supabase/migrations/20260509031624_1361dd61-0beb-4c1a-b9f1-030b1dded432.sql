CREATE OR REPLACE FUNCTION public.cron_check_launch_readiness_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_traffic jsonb; v_orders jsonb;
  v_count int := 0; v_window timestamptz := date_trunc('hour', now());
  v_key text; v_sev text; v_sum text; v_det jsonb;
  v_baseline_3h int;
  v_cta_visible_suppressed boolean := false;
BEGIN
  v_traffic := public.fn_launch_live_traffic_counts();
  v_orders  := public.fn_launch_orders_health();

  -- Traffic-Baseline: Hat die Stunde davor überhaupt Aktivität gehabt?
  SELECT COUNT(*)
    INTO v_baseline_3h
    FROM public.conversion_events
   WHERE created_at BETWEEN now() - interval '4 hours' AND now() - interval '1 hour'
     AND event_type IN ('page_view','lead_magnet_view','quiz_started','cta_visible','cta_click');

  -- cta_visible stall (nun mit Baseline-Gate)
  IF COALESCE((v_traffic->'cta_visible'->>'c1h')::int,0)=0
     AND COALESCE((v_traffic->'cta_visible'->>'c24h')::int,0)>0 THEN
    IF v_baseline_3h >= 10 THEN
      v_key:='launch.tracking.cta_visible_stall'; v_sev:='warn';
      v_sum:='cta_visible: keine Events in letzter Stunde (24h hatte Traffic)';
      v_det:=jsonb_build_object('counts',v_traffic->'cta_visible','traffic_baseline_3h',v_baseline_3h);
      PERFORM public.ops_raise_alert(v_key,v_sev,v_sum,v_det);
      INSERT INTO public.launch_alert_email_outbox(alert_key,severity,summary,details,dedupe_window_start)
      VALUES (v_key,v_sev,v_sum,v_det,v_window) ON CONFLICT DO NOTHING;
      v_count:=v_count+1;
    ELSE
      v_cta_visible_suppressed := true;
    END IF;
  END IF;

  IF COALESCE((v_traffic->'quiz_started'->>'c24h')::int,0)>0
     AND COALESCE((v_traffic->'quiz_started'->>'c1h')::int,0)=0
     AND COALESCE((v_traffic->'cta_clicked'->>'c1h')::int,0)>0 THEN
    v_key:='launch.tracking.quiz_started_drop'; v_sev:='warn';
    v_sum:='quiz_started=0 trotz cta_clicked>0 in letzter Stunde';
    v_det:=jsonb_build_object('traffic',v_traffic);
    PERFORM public.ops_raise_alert(v_key,v_sev,v_sum,v_det);
    INSERT INTO public.launch_alert_email_outbox(alert_key,severity,summary,details,dedupe_window_start)
    VALUES (v_key,v_sev,v_sum,v_det,v_window) ON CONFLICT DO NOTHING;
    v_count:=v_count+1;
  END IF;

  IF COALESCE((v_orders->>'paid_no_grant')::int,0)>0 THEN
    v_key:='launch.orders.paid_no_grant'; v_sev:='critical';
    v_sum:=format('paid_no_grant=%s in letzten 24h',v_orders->>'paid_no_grant');
    v_det:=v_orders;
    PERFORM public.ops_raise_alert(v_key,v_sev,v_sum,v_det);
    INSERT INTO public.launch_alert_email_outbox(alert_key,severity,summary,details,dedupe_window_start)
    VALUES (v_key,v_sev,v_sum,v_det,v_window) ON CONFLICT DO NOTHING;
    v_count:=v_count+1;
  END IF;

  IF COALESCE((v_orders->>'pending_no_session')::int,0)>=5 THEN
    v_key:='launch.orders.pending_no_session_high'; v_sev:='warn';
    v_sum:=format('pending_no_session=%s in letzten 24h',v_orders->>'pending_no_session');
    v_det:=v_orders;
    PERFORM public.ops_raise_alert(v_key,v_sev,v_sum,v_det);
    INSERT INTO public.launch_alert_email_outbox(alert_key,severity,summary,details,dedupe_window_start)
    VALUES (v_key,v_sev,v_sum,v_det,v_window) ON CONFLICT DO NOTHING;
    v_count:=v_count+1;
  END IF;

  INSERT INTO public.auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('launch_readiness_alert_check','system',
          CASE WHEN v_count=0 THEN 'success' ELSE 'warn' END,
          jsonb_build_object(
            'alert_count', v_count,
            'traffic', v_traffic,
            'orders', v_orders,
            'traffic_baseline_3h', v_baseline_3h,
            'cta_visible_suppressed', v_cta_visible_suppressed
          ));
  RETURN jsonb_build_object('ok',true,'alert_count',v_count,'cta_visible_suppressed',v_cta_visible_suppressed);
END $function$;
