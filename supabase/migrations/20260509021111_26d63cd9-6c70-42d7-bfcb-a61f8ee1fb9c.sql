
-- Phase 2: extend admin_get_pruefungsreife_funnel with question_source filter (blueprint|generic|null=all).
-- Filtert event-counts per metadata->>'question_source'. Backward-compatible: NULL → alle Events wie zuvor.

CREATE OR REPLACE FUNCTION public.admin_get_pruefungsreife_funnel(
  p_days integer DEFAULT 7,
  p_question_source text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz;
  v_qs text;
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
  v_mc_avg_pct    numeric;
  v_mc_samples    bigint;
  v_score_avg     numeric;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_days IS NULL OR p_days < 1 THEN p_days := 7; END IF;
  IF p_days > 90 THEN p_days := 90; END IF;
  v_since := now() - make_interval(days => p_days);

  v_qs := NULLIF(lower(trim(coalesce(p_question_source, ''))), '');
  IF v_qs IS NOT NULL AND v_qs NOT IN ('blueprint','generic') THEN
    v_qs := NULL;
  END IF;

  -- Stage 1: landing_view (kein source-filter — Sichtbarkeit auf Marketing-Page agnostisch)
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
    AND event_type IN ('quiz_started','lead_magnet_view')
    AND (v_qs IS NULL OR metadata->>'question_source' = v_qs);
  v_quiz_started := v_started_real + v_started_fb;

  -- Stage 3: quiz_completed merged
  SELECT
    count(*) FILTER (WHERE event_type = 'quiz_completed'),
    count(*) FILTER (WHERE event_type = 'lead_magnet_view'
                       AND metadata->>'stage' = 'quiz_completed')
  INTO v_completed_real, v_completed_fb
  FROM conversion_events
  WHERE created_at >= v_since
    AND event_type IN ('quiz_completed','lead_magnet_view')
    AND (v_qs IS NULL OR metadata->>'question_source' = v_qs);
  v_quiz_completed := v_completed_real + v_completed_fb;

  -- Stage 4: cta_click metadata.location = pruefungscheck_result_primary
  SELECT count(*) INTO v_result_cta
  FROM conversion_events
  WHERE created_at >= v_since
    AND event_type = 'cta_click'
    AND metadata->>'location' = 'pruefungscheck_result_primary'
    AND (v_qs IS NULL OR metadata->>'question_source' = v_qs);

  -- Stage 5: checkout_start / checkout_started (kein source-Filter — checkout läuft separat)
  SELECT count(*) INTO v_checkout
  FROM conversion_events
  WHERE created_at >= v_since
    AND event_type IN ('checkout_start','checkout_started');

  SELECT
    count(*),
    count(*) FILTER (WHERE package_id IS NOT NULL)
  INTO v_pkg_total, v_pkg_resolved
  FROM conversion_events
  WHERE created_at >= v_since
    AND event_type IN ('quiz_started','quiz_completed')
    AND (v_qs IS NULL OR metadata->>'question_source' = v_qs);

  -- MC-Score Aggregat (nur quiz_completed mit mc_score_pct)
  SELECT
    avg((metadata->>'mc_score_pct')::numeric) FILTER (WHERE metadata ? 'mc_score_pct' AND metadata->>'mc_score_pct' ~ '^[0-9]+$'),
    count(*) FILTER (WHERE metadata ? 'mc_score_pct' AND metadata->>'mc_score_pct' ~ '^[0-9]+$'),
    avg((metadata->>'score')::numeric) FILTER (WHERE metadata ? 'score' AND metadata->>'score' ~ '^[0-9]+$')
  INTO v_mc_avg_pct, v_mc_samples, v_score_avg
  FROM conversion_events
  WHERE created_at >= v_since
    AND event_type = 'quiz_completed'
    AND (v_qs IS NULL OR metadata->>'question_source' = v_qs);

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
      AND (v_qs IS NULL OR metadata->>'question_source' = v_qs)
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
    'question_source', v_qs,
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
    'mc_score', jsonb_build_object(
      'avg_pct', CASE WHEN v_mc_avg_pct IS NULL THEN NULL ELSE round(v_mc_avg_pct, 1) END,
      'samples', COALESCE(v_mc_samples, 0)
    ),
    'self_score_avg', CASE WHEN v_score_avg IS NULL THEN NULL ELSE round(v_score_avg, 1) END,
    'top_dropoff', jsonb_build_object('stage', v_top_dropoff, 'pct', v_top_dropoff_pct),
    'top_slugs', v_top_slugs,
    'insights', v_insights,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_pruefungsreife_funnel(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_pruefungsreife_funnel(integer, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_get_pruefungsreife_funnel(integer, text) IS
  'Pruefungsreife-Funnel mit optionalem question_source-Filter (blueprint|generic|NULL=alle). Liefert zusaetzlich mc_score.avg_pct + self_score_avg fuer Phase-2-Vergleich.';
