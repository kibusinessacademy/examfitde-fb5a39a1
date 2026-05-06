
CREATE TABLE IF NOT EXISTS public.launch_readiness_snapshots (
  id bigserial PRIMARY KEY,
  taken_at timestamptz NOT NULL DEFAULT now(),
  snapshot_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  overall_status text NOT NULL,
  can_soft_launch boolean NOT NULL,
  can_public_launch boolean NOT NULL,
  sellable_courses int NOT NULL DEFAULT 0,
  empty_published int NOT NULL DEFAULT 0,
  pricing_ready int NOT NULL DEFAULT 0,
  cta_visible_24h int NOT NULL DEFAULT 0,
  cta_clicked_24h int NOT NULL DEFAULT 0,
  heatmap_click_24h int NOT NULL DEFAULT 0,
  quiz_started_24h int NOT NULL DEFAULT 0,
  checkout_started_24h int NOT NULL DEFAULT 0,
  orders_paid_24h int NOT NULL DEFAULT 0,
  paid_no_grant_24h int NOT NULL DEFAULT 0,
  pending_no_session_24h int NOT NULL DEFAULT 0,
  full_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS launch_readiness_snapshots_date_uidx
  ON public.launch_readiness_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS launch_readiness_snapshots_taken_at_idx
  ON public.launch_readiness_snapshots(taken_at DESC);
ALTER TABLE public.launch_readiness_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_read_snapshots" ON public.launch_readiness_snapshots;
CREATE POLICY "admin_read_snapshots" ON public.launch_readiness_snapshots
  FOR SELECT USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.launch_alert_email_outbox (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  alert_key text NOT NULL,
  severity text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  send_error text,
  dedupe_window_start timestamptz NOT NULL DEFAULT date_trunc('hour', now())
);
CREATE UNIQUE INDEX IF NOT EXISTS launch_alert_email_outbox_dedupe_uidx
  ON public.launch_alert_email_outbox(alert_key, dedupe_window_start);
CREATE INDEX IF NOT EXISTS launch_alert_email_outbox_pending_idx
  ON public.launch_alert_email_outbox(created_at) WHERE sent_at IS NULL;
ALTER TABLE public.launch_alert_email_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_read_outbox" ON public.launch_alert_email_outbox;
CREATE POLICY "admin_read_outbox" ON public.launch_alert_email_outbox
  FOR SELECT USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.fn_launch_live_traffic_counts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH evt AS (
    SELECT event_type,
           count(*) FILTER (WHERE created_at > now() - interval '1 hour')  AS c1h,
           count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS c24h,
           count(*) FILTER (WHERE created_at > now() - interval '48 hours') AS c48h
    FROM public.conversion_events
    WHERE created_at > now() - interval '48 hours'
      AND event_type IN ('cta_visible','cta_clicked','heatmap_click','quiz_started','checkout_started')
    GROUP BY event_type
  )
  SELECT jsonb_build_object(
    'cta_visible',      COALESCE((SELECT row_to_json(evt)::jsonb FROM evt WHERE event_type='cta_visible'),      '{"c1h":0,"c24h":0,"c48h":0}'::jsonb),
    'cta_clicked',      COALESCE((SELECT row_to_json(evt)::jsonb FROM evt WHERE event_type='cta_clicked'),      '{"c1h":0,"c24h":0,"c48h":0}'::jsonb),
    'heatmap_click',    COALESCE((SELECT row_to_json(evt)::jsonb FROM evt WHERE event_type='heatmap_click'),    '{"c1h":0,"c24h":0,"c48h":0}'::jsonb),
    'quiz_started',     COALESCE((SELECT row_to_json(evt)::jsonb FROM evt WHERE event_type='quiz_started'),     '{"c1h":0,"c24h":0,"c48h":0}'::jsonb),
    'checkout_started', COALESCE((SELECT row_to_json(evt)::jsonb FROM evt WHERE event_type='checkout_started'), '{"c1h":0,"c24h":0,"c48h":0}'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.fn_launch_live_traffic_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_launch_live_traffic_counts() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_launch_orders_health()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'pending_no_session', COUNT(*) FILTER (WHERE status='pending' AND stripe_checkout_session_id IS NULL),
    'paid', COUNT(*) FILTER (WHERE status='paid'),
    'paid_no_grant', COUNT(*) FILTER (
      WHERE status='paid' AND NOT EXISTS (
        SELECT 1 FROM public.learner_course_grants g WHERE g.user_id = orders.buyer_user_id))
  )
  FROM public.orders WHERE created_at > now() - interval '24 hours';
$$;
REVOKE ALL ON FUNCTION public.fn_launch_orders_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_launch_orders_health() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_launch_readiness_dashboard_v2()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_base jsonb; v_traffic jsonb; v_orders jsonb;
  v_yesterday public.launch_readiness_snapshots%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  v_base := public.admin_get_launch_readiness_dashboard();
  v_traffic := public.fn_launch_live_traffic_counts();
  v_orders := public.fn_launch_orders_health();
  SELECT * INTO v_yesterday FROM public.launch_readiness_snapshots
    WHERE snapshot_date < (now() AT TIME ZONE 'UTC')::date
    ORDER BY snapshot_date DESC LIMIT 1;
  RETURN v_base
    || jsonb_build_object('live_traffic', v_traffic)
    || jsonb_build_object('orders_health', v_orders)
    || jsonb_build_object('previous_snapshot',
        CASE WHEN v_yesterday.id IS NULL THEN NULL ELSE
          jsonb_build_object(
            'snapshot_date', v_yesterday.snapshot_date,
            'overall_status', v_yesterday.overall_status,
            'sellable_courses', v_yesterday.sellable_courses,
            'cta_visible_24h', v_yesterday.cta_visible_24h,
            'quiz_started_24h', v_yesterday.quiz_started_24h,
            'checkout_started_24h', v_yesterday.checkout_started_24h,
            'paid_no_grant_24h', v_yesterday.paid_no_grant_24h)
        END);
END $$;
REVOKE ALL ON FUNCTION public.admin_get_launch_readiness_dashboard_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_launch_readiness_dashboard_v2() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_launch_readiness_timeseries(p_days int DEFAULT 14)
RETURNS SETOF public.launch_readiness_snapshots
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM public.launch_readiness_snapshots
  WHERE snapshot_date > (now() AT TIME ZONE 'UTC')::date - p_days
  ORDER BY snapshot_date DESC
$$;
REVOKE ALL ON FUNCTION public.admin_get_launch_readiness_timeseries(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_launch_readiness_timeseries(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.cron_take_launch_readiness_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sellable int; v_empty int; v_pricing int; v_overall text; v_soft boolean; v_public boolean;
  v_traffic jsonb; v_orders jsonb; v_id bigint;
BEGIN
  SELECT COUNT(*) INTO v_sellable FROM public.v_public_sellable_courses WHERE is_sellable=true;
  SELECT COUNT(*) INTO v_empty FROM public.admin_get_empty_published_courses();
  SELECT COUNT(DISTINCT product_id) INTO v_pricing FROM public.v_public_sellable_courses
    WHERE is_sellable=true AND has_stripe_price=true;
  v_soft := v_pricing > 0;
  v_public := v_soft AND v_empty=0;
  v_overall := CASE WHEN v_public THEN 'green' WHEN v_soft THEN 'yellow' ELSE 'red' END;
  v_traffic := public.fn_launch_live_traffic_counts();
  v_orders := public.fn_launch_orders_health();

  INSERT INTO public.launch_readiness_snapshots(
    overall_status,can_soft_launch,can_public_launch,
    sellable_courses,empty_published,pricing_ready,
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

  INSERT INTO public.auto_heal_log(action_type,target_type,result_status,details)
  VALUES ('launch_readiness_snapshot','system','success',jsonb_build_object('snapshot_id',v_id));
  RETURN jsonb_build_object('ok',true,'snapshot_id',v_id);
END $$;
REVOKE ALL ON FUNCTION public.cron_take_launch_readiness_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_take_launch_readiness_snapshot() TO service_role;

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

  INSERT INTO public.auto_heal_log(action_type,target_type,result_status,details)
  VALUES ('launch_readiness_alert_check','system',
          CASE WHEN v_count=0 THEN 'success' ELSE 'warn' END,
          jsonb_build_object('alert_count',v_count,'traffic',v_traffic,'orders',v_orders));
  RETURN jsonb_build_object('ok',true,'alert_count',v_count);
END $$;
REVOKE ALL ON FUNCTION public.cron_check_launch_readiness_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_check_launch_readiness_alerts() TO service_role;

-- RPC for admin UI to read pending alerts
CREATE OR REPLACE FUNCTION public.admin_get_recent_launch_alerts(p_hours int DEFAULT 48)
RETURNS TABLE(id bigint, created_at timestamptz, alert_key text, severity text, summary text, details jsonb, sent_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT id, created_at, alert_key, severity, summary, details, sent_at
  FROM public.launch_alert_email_outbox
  WHERE created_at > now() - make_interval(hours => p_hours)
  ORDER BY created_at DESC LIMIT 100
$$;
REVOKE ALL ON FUNCTION public.admin_get_recent_launch_alerts(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_recent_launch_alerts(int) TO authenticated;
