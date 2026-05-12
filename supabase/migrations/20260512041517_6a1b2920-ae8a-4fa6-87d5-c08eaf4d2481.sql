
-- ============================================================
-- 1) Tighten smoke-email filter on v_admin_paid_orders_ops
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
  AND COALESCE(o.billing_email, '') NOT ILIKE '%@test.local'
  AND COALESCE(o.billing_email, '') NOT ILIKE '%@example.test'
  AND COALESCE(o.billing_email, '') NOT ILIKE 'smoke-%'
GROUP BY o.id;

REVOKE ALL ON public.v_admin_paid_orders_ops FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_paid_orders_ops TO service_role;

-- ============================================================
-- 2) Admin-controlled test traffic event emitter
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_emit_test_traffic_events(
  p_page_path text DEFAULT '/admin/ops/funnel/test',
  p_cta_location text DEFAULT 'admin_test'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anon text := 'admin_test_' || gen_random_uuid()::text;
  v_session text := 'admin_test_session_' || gen_random_uuid()::text;
  v_meta jsonb;
  v_inserted int := 0;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  v_meta := jsonb_build_object(
    'source', 'admin_test_run',
    'cta_location', p_cta_location,
    'page_path', p_page_path,
    'emitted_by', auth.uid(),
    'emitted_at', now()
  );

  INSERT INTO public.conversion_events(event_type, anonymous_id, session_id, page_path, metadata, created_at)
  VALUES
    ('cta_visible',  v_anon, v_session, p_page_path, v_meta, now()),
    ('cta_clicked',  v_anon, v_session, p_page_path, v_meta, now() + interval '1 second'),
    ('quiz_started', v_anon, v_session, p_page_path, v_meta, now() + interval '2 seconds');

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES (
    'admin_emit_test_traffic_events',
    'system',
    'inserted',
    jsonb_build_object(
      'inserted', v_inserted,
      'anonymous_id', v_anon,
      'session_id', v_session,
      'page_path', p_page_path,
      'admin_user', auth.uid()
    )
  );

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'anonymous_id', v_anon,
    'session_id', v_session,
    'events', ARRAY['cta_visible','cta_clicked','quiz_started']
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_emit_test_traffic_events(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_emit_test_traffic_events(text, text) TO authenticated;

-- ============================================================
-- 3) Launch Readiness Drilldown
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_launch_readiness_drilldown()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap public.launch_readiness_snapshots%ROWTYPE;
  v_axes jsonb := '[]'::jsonb;
  v_axis jsonb;
  v_orders_status text;
  v_orders_reasons text[] := ARRAY[]::text[];
  v_traffic_status text;
  v_traffic_reasons text[] := ARRAY[]::text[];
  v_seo_status text := 'green';
  v_seo_reasons text[] := ARRAY[]::text[];
  v_pipeline_status text := 'green';
  v_pipeline_reasons text[] := ARRAY[]::text[];
  v_growth_status text;
  v_growth_reasons text[] := ARRAY[]::text[];
  v_failed_jobs int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT * INTO v_snap
  FROM public.launch_readiness_snapshots
  ORDER BY taken_at DESC
  LIMIT 1;

  IF v_snap.id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_snapshot', 'hint', 'cron_take_launch_readiness_snapshot has not run yet');
  END IF;

  -- Orders axis
  IF v_snap.paid_no_grant_24h > 0 THEN
    v_orders_status := 'red';
    v_orders_reasons := array_append(v_orders_reasons, format('paid_no_grant_24h=%s', v_snap.paid_no_grant_24h));
  ELSIF v_snap.pending_no_session_24h > 0 THEN
    v_orders_status := 'yellow';
    v_orders_reasons := array_append(v_orders_reasons, format('pending_no_session_24h=%s', v_snap.pending_no_session_24h));
  ELSE
    v_orders_status := 'green';
  END IF;

  v_axes := v_axes || jsonb_build_object(
    'axis', 'orders',
    'status', v_orders_status,
    'reasons', v_orders_reasons,
    'metrics', jsonb_build_object(
      'orders_paid_24h', v_snap.orders_paid_24h,
      'paid_no_grant_24h', v_snap.paid_no_grant_24h,
      'pending_no_session_24h', v_snap.pending_no_session_24h
    ),
    'route', '/admin/ops/orders',
    'cta', 'Paid Orders öffnen'
  );

  -- Traffic axis (SSOT for Yellow on can_public_launch)
  IF v_snap.cta_visible_24h >= 50 AND v_snap.cta_clicked_24h = 0 AND v_snap.quiz_started_24h = 0 THEN
    v_traffic_status := 'red';
    v_traffic_reasons := array_append(v_traffic_reasons, 'CTAs sichtbar, aber 0 Klicks und 0 Quiz-Starts');
  ELSIF v_snap.cta_clicked_24h = 0 AND v_snap.quiz_started_24h = 0 AND v_snap.checkout_started_24h = 0 THEN
    v_traffic_status := 'yellow';
    v_traffic_reasons := array_append(v_traffic_reasons, 'Keine Downstream-Engagement-Events in 24h');
  ELSE
    v_traffic_status := 'green';
  END IF;

  v_axes := v_axes || jsonb_build_object(
    'axis', 'traffic',
    'status', v_traffic_status,
    'reasons', v_traffic_reasons,
    'metrics', jsonb_build_object(
      'cta_visible_24h', v_snap.cta_visible_24h,
      'cta_clicked_24h', v_snap.cta_clicked_24h,
      'quiz_started_24h', v_snap.quiz_started_24h,
      'checkout_started_24h', v_snap.checkout_started_24h
    ),
    'route', '/admin/ops/funnel',
    'cta', 'Traffic-Funnel öffnen'
  );

  -- Growth axis
  IF v_snap.sellable_courses < 5 THEN
    v_growth_status := 'red';
    v_growth_reasons := array_append(v_growth_reasons, format('sellable_courses=%s (<5)', v_snap.sellable_courses));
  ELSIF v_snap.pricing_ready < v_snap.sellable_courses THEN
    v_growth_status := 'yellow';
    v_growth_reasons := array_append(v_growth_reasons, format('pricing_ready=%s/%s', v_snap.pricing_ready, v_snap.sellable_courses));
  ELSE
    v_growth_status := 'green';
  END IF;

  v_axes := v_axes || jsonb_build_object(
    'axis', 'growth',
    'status', v_growth_status,
    'reasons', v_growth_reasons,
    'metrics', jsonb_build_object(
      'sellable_courses', v_snap.sellable_courses,
      'pricing_ready', v_snap.pricing_ready,
      'empty_published', v_snap.empty_published
    ),
    'route', '/admin/growth',
    'cta', 'Growth öffnen'
  );

  -- SEO axis (basic — derived from sellable_courses + empty_published)
  IF v_snap.empty_published > 0 THEN
    v_seo_status := 'yellow';
    v_seo_reasons := array_append(v_seo_reasons, format('empty_published=%s', v_snap.empty_published));
  END IF;

  v_axes := v_axes || jsonb_build_object(
    'axis', 'seo',
    'status', v_seo_status,
    'reasons', v_seo_reasons,
    'metrics', jsonb_build_object(
      'sellable_courses', v_snap.sellable_courses,
      'empty_published', v_snap.empty_published
    ),
    'route', '/admin/growth',
    'cta', 'SEO/Growth öffnen'
  );

  -- Pipeline axis
  SELECT COUNT(*) INTO v_failed_jobs
  FROM public.job_queue
  WHERE status = 'failed' AND created_at > now() - interval '1 hour';

  IF v_failed_jobs > 20 THEN
    v_pipeline_status := 'red';
    v_pipeline_reasons := array_append(v_pipeline_reasons, format('failed_jobs_1h=%s (>20)', v_failed_jobs));
  ELSIF v_failed_jobs > 5 THEN
    v_pipeline_status := 'yellow';
    v_pipeline_reasons := array_append(v_pipeline_reasons, format('failed_jobs_1h=%s', v_failed_jobs));
  END IF;

  v_axes := v_axes || jsonb_build_object(
    'axis', 'pipeline',
    'status', v_pipeline_status,
    'reasons', v_pipeline_reasons,
    'metrics', jsonb_build_object('failed_jobs_1h', v_failed_jobs),
    'route', '/admin/heal',
    'cta', 'Heal-Hub öffnen'
  );

  RETURN jsonb_build_object(
    'taken_at', v_snap.taken_at,
    'overall_status', v_snap.overall_status,
    'can_soft_launch', v_snap.can_soft_launch,
    'can_public_launch', v_snap.can_public_launch,
    'axes', v_axes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_launch_readiness_drilldown() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_launch_readiness_drilldown() TO authenticated;
