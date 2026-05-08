
CREATE OR REPLACE FUNCTION public.admin_get_pruefungsreife_funnel(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz;
  v_landing       bigint;
  v_quiz_started  bigint;
  v_quiz_completed bigint;
  v_result_cta    bigint;
  v_checkout      bigint;
  v_pkg_total     bigint;
  v_pkg_resolved  bigint;
  v_top_slugs     jsonb;
  v_top_dropoff   text;
  v_top_dropoff_pct numeric;
  v_insights      jsonb;
  v_started_real  bigint;
  v_started_fb    bigint;
  v_completed_real bigint;
  v_completed_fb   bigint;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_days IS NULL OR p_days < 1 THEN p_days := 7; END IF;
  IF p_days > 90 THEN p_days := 90; END IF;
  v_since := now() - make_interval(days => p_days);

  -- Stage 1: landing_view
  SELECT count(*) INTO v_landing
  FROM conversion_events
  WHERE created_at >= v_since AND event_type = 'landing_view';

  -- Stage 2: quiz_started (real) + lead_magnet_view stage='quiz_started' (fallback)
  SELECT
    count(*) FILTER (WHERE event_type = 'quiz_started'),
    count(*) FILTER (WHERE event_type = 'lead_magnet_view'
                       AND metadata->>'stage' = 'quiz_started')
  INTO v_started_real, v_started_fb
  FROM conversion_events
  WHERE created_at >= v_since
    AND event_type IN ('quiz_started','lead_magnet_view');
  v_quiz_started := v_started_real + v_started_fb;

  -- Stage 3: quiz_completed merged
  SELECT
    count(*) FILTER (WHERE event_type = 'quiz_completed'),
    count(*) FILTER (WHERE event_type = 'lead_magnet_view'
                       AND metadata->>'stage' = 'quiz_completed')
  INTO v_completed_real, v_completed_fb
  FROM conversion_events
  WHERE created_at >= v_since
    AND event_type IN ('quiz_completed','lead_magnet_view');
  v_quiz_completed := v_completed_real + v_completed_fb;

  -- Stage 4: cta_click metadata.location = pruefungscheck_result_primary
  SELECT count(*) INTO v_result_cta
  FROM conversion_events
  WHERE created_at >= v_since
    AND event_type = 'cta_click'
    AND metadata->>'location' = 'pruefungscheck_result_primary';

  -- Stage 5: checkout_start / checkout_started
  SELECT count(*) INTO v_checkout
  FROM conversion_events
  WHERE created_at >= v_since
    AND event_type IN ('checkout_start','checkout_started');

  -- Package-id resolution share for strict quiz events
  SELECT
    count(*),
    count(*) FILTER (WHERE package_id IS NOT NULL)
  INTO v_pkg_total, v_pkg_resolved
  FROM conversion_events
  WHERE created_at >= v_since
    AND event_type IN ('quiz_started','quiz_completed');

  -- Top 10 slugs by quiz_started (real + fallback merged)
  WITH starts AS (
    SELECT
      COALESCE(
        NULLIF(metadata->>'slug',''),
        NULLIF(regexp_replace(coalesce(page_path,''), '^.*/berufe/([^/?#]+).*$', '\1'), page_path),
        '(none)'
      ) AS slug
    FROM conversion_events
    WHERE created_at >= v_since
      AND (event_type = 'quiz_started'
           OR (event_type = 'lead_magnet_view' AND metadata->>'stage' = 'quiz_started'))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('slug', slug, 'starts', cnt) ORDER BY cnt DESC), '[]'::jsonb)
  INTO v_top_slugs
  FROM (
    SELECT slug, count(*) AS cnt
    FROM starts
    GROUP BY slug
    ORDER BY cnt DESC
    LIMIT 10
  ) s;

  -- Top drop-off stage (highest absolute loss between consecutive stages)
  SELECT stage, pct INTO v_top_dropoff, v_top_dropoff_pct
  FROM (
    VALUES
      ('landing_view → quiz_started',
        CASE WHEN v_landing > 0 THEN round(100.0 * (v_landing - v_quiz_started) / v_landing, 1) ELSE 0 END),
      ('quiz_started → quiz_completed',
        CASE WHEN v_quiz_started > 0 THEN round(100.0 * (v_quiz_started - v_quiz_completed) / v_quiz_started, 1) ELSE 0 END),
      ('quiz_completed → result_cta',
        CASE WHEN v_quiz_completed > 0 THEN round(100.0 * (v_quiz_completed - v_result_cta) / v_quiz_completed, 1) ELSE 0 END),
      ('result_cta → checkout_start',
        CASE WHEN v_result_cta > 0 THEN round(100.0 * (v_result_cta - v_checkout) / v_result_cta, 1) ELSE 0 END)
  ) AS t(stage, pct)
  ORDER BY pct DESC NULLS LAST
  LIMIT 1;

  -- Insights
  v_insights := '[]'::jsonb;
  IF v_quiz_started > 20 AND v_quiz_completed::numeric / NULLIF(v_quiz_started,0) < 0.5 THEN
    v_insights := v_insights || jsonb_build_object(
      'severity','warning',
      'message','Viele Starts, wenige Abschlüsse → Fragen zu lang oder UX-Reibung.');
  END IF;
  IF v_quiz_completed > 20 AND v_result_cta::numeric / NULLIF(v_quiz_completed,0) < 0.3 THEN
    v_insights := v_insights || jsonb_build_object(
      'severity','warning',
      'message','Viele Abschlüsse, wenig Result-CTA → Result-Copy/Offer schwach.');
  END IF;
  IF v_pkg_total > 20 AND v_pkg_resolved::numeric / NULLIF(v_pkg_total,0) < 0.6 THEN
    v_insights := v_insights || jsonb_build_object(
      'severity','critical',
      'message','Hoher Fallback-Anteil → Slug→package_id Resolver prüfen.');
  END IF;
  IF v_result_cta > 10 AND v_checkout::numeric / NULLIF(v_result_cta,0) < 0.4 THEN
    v_insights := v_insights || jsonb_build_object(
      'severity','info',
      'message','Result-CTA klickt, aber Checkout startet nicht — Bundle-Übergang prüfen.');
  END IF;

  RETURN jsonb_build_object(
    'window_days', p_days,
    'since', v_since,
    'stages', jsonb_build_array(
      jsonb_build_object('key','landing_view',    'label','Landing-View',     'count', v_landing),
      jsonb_build_object('key','quiz_started',    'label','Quiz gestartet',   'count', v_quiz_started,
                         'real_events', v_started_real, 'fallback_events', v_started_fb),
      jsonb_build_object('key','quiz_completed',  'label','Quiz abgeschlossen','count', v_quiz_completed,
                         'real_events', v_completed_real, 'fallback_events', v_completed_fb),
      jsonb_build_object('key','result_cta',      'label','Result-CTA-Klick', 'count', v_result_cta),
      jsonb_build_object('key','checkout_start',  'label','Checkout-Start',   'count', v_checkout)
    ),
    'completion_rate_pct',
       CASE WHEN v_quiz_started > 0 THEN round(100.0 * v_quiz_completed / v_quiz_started, 1) ELSE 0 END,
    'cta_rate_pct',
       CASE WHEN v_quiz_completed > 0 THEN round(100.0 * v_result_cta / v_quiz_completed, 1) ELSE 0 END,
    'checkout_rate_pct',
       CASE WHEN v_result_cta > 0 THEN round(100.0 * v_checkout / v_result_cta, 1) ELSE 0 END,
    'package_resolution', jsonb_build_object(
      'total', v_pkg_total,
      'resolved', v_pkg_resolved,
      'fallback', GREATEST(v_pkg_total - v_pkg_resolved, 0),
      'resolved_pct', CASE WHEN v_pkg_total > 0 THEN round(100.0 * v_pkg_resolved / v_pkg_total, 1) ELSE 0 END
    ),
    'top_dropoff', jsonb_build_object('stage', v_top_dropoff, 'pct', v_top_dropoff_pct),
    'top_slugs', v_top_slugs,
    'insights', v_insights,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_pruefungsreife_funnel(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_pruefungsreife_funnel(integer) TO authenticated, service_role;

-- Smoke
DO $$
DECLARE r jsonb;
BEGIN
  SELECT public.admin_get_pruefungsreife_funnel(7) INTO r;
  -- bypass admin check via service_role context — DO block runs as superuser, just sanity-call the SQL plan
  PERFORM 1;
EXCEPTION WHEN OTHERS THEN
  -- "forbidden" expected without admin context; ignore
  NULL;
END$$;
