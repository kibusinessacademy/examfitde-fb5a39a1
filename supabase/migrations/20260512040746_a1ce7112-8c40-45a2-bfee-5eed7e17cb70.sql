
-- ============================================================
-- 1) Paid Orders Ops SSOT
-- ============================================================
CREATE OR REPLACE VIEW public.v_admin_paid_orders_ops AS
SELECT
  o.id AS order_id,
  o.created_at,
  o.updated_at AS paid_at,
  o.status,
  o.buyer_user_id,
  o.learner_user_id,
  COALESCE(o.learner_user_id, o.buyer_user_id) AS effective_user_id,
  o.billing_email,
  o.stripe_checkout_session_id,
  o.stripe_payment_intent_id,
  o.total_cents,
  o.currency,
  COUNT(oi.id) AS item_count,
  COUNT(p.id) FILTER (WHERE p.curriculum_id IS NOT NULL) AS fulfillable_item_count,
  bool_or(g.id IS NOT NULL) AS has_grant,
  COALESCE(
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'product_id', p.id,
        'product_slug', p.slug,
        'product_title', p.title,
        'product_type', p.product_type,
        'curriculum_id', p.curriculum_id,
        'has_grant', g.id IS NOT NULL,
        'grant_status', g.status
      )
    ) FILTER (WHERE p.id IS NOT NULL),
    '[]'::jsonb
  ) AS items,
  CASE
    WHEN o.status = 'paid'
      AND COUNT(oi.id) > 0
      AND COUNT(p.id) FILTER (WHERE p.curriculum_id IS NOT NULL) > 0
      AND NOT bool_or(g.id IS NOT NULL)
      THEN 'paid_no_grant'
    WHEN o.status = 'paid' AND bool_or(g.id IS NOT NULL)
      THEN 'granted'
    WHEN o.status = 'paid'
      THEN 'paid_not_fulfillable'
    ELSE o.status
  END AS ops_status
FROM public.orders o
LEFT JOIN public.order_items oi ON oi.order_id = o.id
LEFT JOIN public.products p ON p.id = oi.product_id
LEFT JOIN public.learner_course_grants g
  ON g.user_id = COALESCE(o.learner_user_id, o.buyer_user_id)
 AND g.curriculum_id = p.curriculum_id
WHERE o.status = 'paid'
  AND COALESCE(o.stripe_checkout_session_id, '') NOT LIKE 'cs_test_synthetic%'
  AND COALESCE(o.stripe_checkout_session_id, '') NOT LIKE 'cs_test_access%'
  AND COALESCE(o.billing_email, '') NOT ILIKE '%@examfit-smoke.local'
  AND COALESCE(o.billing_email, '') NOT ILIKE '%@test.examfit.de'
GROUP BY o.id;

REVOKE ALL ON public.v_admin_paid_orders_ops FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_paid_orders_ops TO service_role;

-- Admin-gated RPC
CREATE OR REPLACE FUNCTION public.admin_get_paid_orders_ops(
  p_status text DEFAULT NULL,
  p_limit  int  DEFAULT 100
) RETURNS SETOF public.v_admin_paid_orders_ops
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.v_admin_paid_orders_ops v
  WHERE has_role(auth.uid(), 'admin'::app_role)
    AND (p_status IS NULL OR v.ops_status = p_status)
  ORDER BY v.paid_at DESC NULLS LAST, v.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
$$;

REVOKE ALL ON FUNCTION public.admin_get_paid_orders_ops(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_paid_orders_ops(text, int) TO authenticated;

-- ============================================================
-- 2) Traffic Funnel 24h SSOT
-- ============================================================
CREATE OR REPLACE VIEW public.v_admin_traffic_funnel_24h AS
WITH ev AS (
  SELECT event_type, page_path, anonymous_id
  FROM public.conversion_events
  WHERE created_at > now() - interval '24 hours'
)
SELECT
  COUNT(*) FILTER (WHERE event_type IN ('page_view','landing_view','shop_view','pricing_hero_view')) AS page_views,
  COUNT(*) FILTER (WHERE event_type = 'cta_visible')      AS cta_visible,
  COUNT(*) FILTER (WHERE event_type IN ('cta_click','cta_clicked','hero_cta_click','quiz_cta_clicked','result_cta_clicked','bundle_cta_clicked','pricing_hero_primary_click')) AS cta_clicked,
  COUNT(*) FILTER (WHERE event_type IN ('heatmap_click','heatmap_scroll_depth')) AS heatmap_signals,
  COUNT(*) FILTER (WHERE event_type IN ('quiz_start','quiz_started')) AS quiz_started,
  COUNT(*) FILTER (WHERE event_type IN ('quiz_complete','quiz_completed','quiz_result_viewed')) AS quiz_completed,
  COUNT(*) FILTER (WHERE event_type IN ('checkout_start','checkout_started')) AS checkout_started,
  COUNT(*) FILTER (WHERE event_type IN ('checkout_complete','checkout_completed')) AS checkout_completed,
  COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL) AS unique_visitors
FROM ev;

REVOKE ALL ON public.v_admin_traffic_funnel_24h FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_traffic_funnel_24h TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_traffic_funnel_24h()
RETURNS public.v_admin_traffic_funnel_24h
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.*
  FROM public.v_admin_traffic_funnel_24h v
  WHERE has_role(auth.uid(), 'admin'::app_role);
$$;

REVOKE ALL ON FUNCTION public.admin_get_traffic_funnel_24h() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_traffic_funnel_24h() TO authenticated;

-- Per-event 24h breakdown (for charting)
CREATE OR REPLACE FUNCTION public.admin_get_traffic_funnel_breakdown_24h()
RETURNS TABLE (event_type text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT event_type, COUNT(*) AS count
  FROM public.conversion_events
  WHERE created_at > now() - interval '24 hours'
    AND has_role(auth.uid(), 'admin'::app_role)
  GROUP BY event_type
  ORDER BY count DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_traffic_funnel_breakdown_24h() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_traffic_funnel_breakdown_24h() TO authenticated;

-- ============================================================
-- 3) Traffic Stall Alert
-- ============================================================
CREATE OR REPLACE FUNCTION public.cron_check_traffic_stall_alert()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_funnel public.v_admin_traffic_funnel_24h%ROWTYPE;
  v_should_alert boolean;
  v_alert_id uuid;
  v_threshold_visible int := 50;
BEGIN
  SELECT * INTO v_funnel FROM public.v_admin_traffic_funnel_24h;

  v_should_alert :=
       v_funnel.cta_visible >= v_threshold_visible
   AND v_funnel.cta_clicked = 0
   AND v_funnel.quiz_started = 0
   AND v_funnel.checkout_started = 0;

  IF v_should_alert THEN
    INSERT INTO public.heal_alert_notifications(
      alert_key, severity, title, body, metadata
    )
    VALUES (
      'launch.traffic.stall_no_clicks',
      'warning',
      'Traffic-Stall: CTAs sichtbar, aber keine Klicks',
      format('cta_visible_24h=%s, cta_clicked=0, quiz_started=0, checkout_started=0', v_funnel.cta_visible),
      jsonb_build_object(
        'cta_visible', v_funnel.cta_visible,
        'cta_clicked', v_funnel.cta_clicked,
        'quiz_started', v_funnel.quiz_started,
        'checkout_started', v_funnel.checkout_started,
        'page_views', v_funnel.page_views,
        'unique_visitors', v_funnel.unique_visitors,
        'threshold_visible', v_threshold_visible
      )
    )
    RETURNING id INTO v_alert_id;
  END IF;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES (
    'cron_check_traffic_stall_alert',
    'system',
    CASE WHEN v_should_alert THEN 'alert_raised' ELSE 'noop' END,
    jsonb_build_object(
      'cta_visible', v_funnel.cta_visible,
      'cta_clicked', v_funnel.cta_clicked,
      'quiz_started', v_funnel.quiz_started,
      'checkout_started', v_funnel.checkout_started,
      'alert_id', v_alert_id,
      'threshold_visible', v_threshold_visible
    )
  );

  RETURN jsonb_build_object(
    'alert_raised', v_should_alert,
    'cta_visible', v_funnel.cta_visible,
    'cta_clicked', v_funnel.cta_clicked
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cron_check_traffic_stall_alert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cron_check_traffic_stall_alert() TO service_role;

-- Hourly cron
DO $$
DECLARE
  v_existing_jobid bigint;
BEGIN
  SELECT jobid INTO v_existing_jobid FROM cron.job WHERE jobname = 'traffic-stall-alert-hourly';
  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
  END IF;
  PERFORM cron.schedule(
    'traffic-stall-alert-hourly',
    '17 * * * *',
    $cron$ SELECT public.cron_check_traffic_stall_alert(); $cron$
  );
END $$;
