
CREATE OR REPLACE FUNCTION public.cron_take_launch_readiness_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sellable int; v_empty int; v_pricing int; v_overall text; v_soft boolean; v_public boolean;
  v_traffic jsonb; v_orders jsonb; v_id bigint;
BEGIN
  SELECT COUNT(*) INTO v_sellable FROM public.v_public_sellable_courses WHERE is_sellable=true;
  SELECT COUNT(*) INTO v_empty FROM public.courses c
   WHERE c.status='published'
     AND NOT EXISTS (SELECT 1 FROM public.modules m
        JOIN public.lessons l ON l.module_id=m.id
        WHERE m.course_id=c.id AND l.status='ready' LIMIT 1);
  SELECT COUNT(DISTINCT product_id) INTO v_pricing FROM public.v_public_sellable_courses
    WHERE is_sellable=true AND has_stripe_price=true;
  v_soft := v_pricing > 0;
  v_public := v_soft AND v_empty=0;
  v_overall := CASE WHEN v_public THEN 'green' WHEN v_soft THEN 'yellow' ELSE 'red' END;
  v_traffic := public.fn_launch_live_traffic_counts();
  v_orders := public.fn_launch_orders_health();
  INSERT INTO public.launch_readiness_snapshots(
    overall_status,can_soft_launch,can_public_launch,sellable_courses,empty_published,pricing_ready,
    cta_visible_24h,cta_clicked_24h,heatmap_click_24h,quiz_started_24h,checkout_started_24h,
    orders_paid_24h,paid_no_grant_24h,pending_no_session_24h,full_payload)
  VALUES (
    v_overall,v_soft,v_public,v_sellable,v_empty,v_pricing,
    COALESCE((v_traffic->'cta_visible'->>'c24h')::int,0),
    COALESCE((v_traffic->'cta_clicked'->>'c24h')::int,0),
    COALESCE((v_traffic->'heatmap_click'->>'c24h')::int,0),
    COALESCE((v_traffic->'quiz_started'->>'c24h')::int,0),
    COALESCE((v_traffic->'checkout_started'->>'c24h')::int,0),
    COALESCE((v_orders->>'paid')::int,0),
    COALESCE((v_orders->>'paid_no_grant')::int,0),
    COALESCE((v_orders->>'pending_no_session')::int,0),
    jsonb_build_object('traffic',v_traffic,'orders',v_orders))
  ON CONFLICT (snapshot_date) DO UPDATE SET
    taken_at=EXCLUDED.taken_at, overall_status=EXCLUDED.overall_status,
    can_soft_launch=EXCLUDED.can_soft_launch, can_public_launch=EXCLUDED.can_public_launch,
    sellable_courses=EXCLUDED.sellable_courses, empty_published=EXCLUDED.empty_published,
    pricing_ready=EXCLUDED.pricing_ready,
    cta_visible_24h=EXCLUDED.cta_visible_24h, cta_clicked_24h=EXCLUDED.cta_clicked_24h,
    heatmap_click_24h=EXCLUDED.heatmap_click_24h, quiz_started_24h=EXCLUDED.quiz_started_24h,
    checkout_started_24h=EXCLUDED.checkout_started_24h,
    orders_paid_24h=EXCLUDED.orders_paid_24h, paid_no_grant_24h=EXCLUDED.paid_no_grant_24h,
    pending_no_session_24h=EXCLUDED.pending_no_session_24h, full_payload=EXCLUDED.full_payload
  RETURNING id INTO v_id;
  INSERT INTO public.auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('launch_readiness_snapshot','system','success',jsonb_build_object('snapshot_id',v_id));
  RETURN jsonb_build_object('ok',true,'snapshot_id',v_id);
END $$;

CREATE OR REPLACE FUNCTION public.cron_check_launch_readiness_alerts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_traffic jsonb; v_orders jsonb;
  v_count int := 0; v_window timestamptz := date_trunc('hour', now());
  v_key text; v_sev text; v_sum text; v_det jsonb;
BEGIN
  v_traffic := public.fn_launch_live_traffic_counts();
  v_orders := public.fn_launch_orders_health();
  IF COALESCE((v_traffic->'cta_visible'->>'c1h')::int,0)=0
     AND COALESCE((v_traffic->'cta_visible'->>'c24h')::int,0)>0 THEN
    v_key:='launch.tracking.cta_visible_stall'; v_sev:='warn';
    v_sum:='cta_visible: keine Events in letzter Stunde (24h hatte Traffic)';
    v_det:=jsonb_build_object('counts',v_traffic->'cta_visible');
    PERFORM public.ops_raise_alert(v_key,v_sev,v_sum,v_det);
    INSERT INTO public.launch_alert_email_outbox(alert_key,severity,summary,details,dedupe_window_start)
    VALUES (v_key,v_sev,v_sum,v_det,v_window) ON CONFLICT DO NOTHING;
    v_count:=v_count+1;
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
          jsonb_build_object('alert_count',v_count,'traffic',v_traffic,'orders',v_orders));
  RETURN jsonb_build_object('ok',true,'alert_count',v_count);
END $$;
