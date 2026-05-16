CREATE OR REPLACE VIEW public.v_package_growth_signals_v1 AS
WITH base AS (
  SELECT cp.id AS package_id, cp.package_key, cp.title AS package_title,
         cp.track::text AS track, cp.curriculum_id, cp.published_at
  FROM public.course_packages cp
  WHERE cp.is_published = true AND COALESCE(cp.archived,false) = false
),
ppr AS (
  SELECT package_id,
         COALESCE(seo_present,false)                AS seo_present,
         COALESCE(tracking_pricing_view,false)      AS tracking_pricing_view,
         COALESCE(tracking_checkout_started,false)  AS tracking_checkout_started,
         COALESCE(seo_done_rows,0)                  AS seo_done_rows,
         COALESCE(seo_backlog_rows,0)               AS seo_backlog_rows
  FROM public.v_post_publish_readiness
),
canonical AS (
  SELECT package_id,
         BOOL_OR(drift_severity IS NOT NULL AND drift_severity <> 'ok') AS has_canonical_drift
  FROM public.v_seo_canonical_drift
  WHERE package_id IS NOT NULL
  GROUP BY package_id
),
dead_end AS (
  SELECT NULLIF(package_id,'')::uuid AS package_id,
         COUNT(*)::int AS dead_end_count
  FROM public.v_seo_dead_end_drift
  WHERE package_id IS NOT NULL AND package_id <> ''
  GROUP BY NULLIF(package_id,'')::uuid
),
ce AS (
  SELECT package_id, COUNT(*)::int AS conversion_event_count
  FROM public.conversion_events
  WHERE package_id IS NOT NULL
  GROUP BY package_id
),
amp AS (
  SELECT package_id,
         COALESCE(has_blog,false)                 AS has_blog,
         COALESCE(has_og_image,false)             AS has_og_image,
         COALESCE(has_indexnow,false)             AS has_indexnow,
         COALESCE(has_internal_links,false)       AS has_internal_links,
         COALESCE(has_campaign_assets,false)      AS has_campaign_assets,
         COALESCE(has_distribution_targets,false) AS has_distribution_targets
  FROM public.v_post_publish_growth_coverage
)
SELECT
  b.package_id, b.package_key, b.package_title, b.track, b.curriculum_id, b.published_at,
  COALESCE(ppr.seo_present,false)                    AS sig_seo_present,
  NOT COALESCE(canonical.has_canonical_drift,false)  AS sig_canonical_ok,
  COALESCE(dead_end.dead_end_count,0) = 0            AS sig_no_dead_end,
  COALESCE(ppr.tracking_pricing_view,false)          AS sig_tracking_pricing_view,
  COALESCE(ppr.tracking_checkout_started,false)      AS sig_tracking_checkout_started,
  COALESCE(ce.conversion_event_count,0) > 0          AS sig_conversion_events_present,
  COALESCE(amp.has_blog,false)                 AS sig_has_blog,
  COALESCE(amp.has_og_image,false)             AS sig_has_og_image,
  COALESCE(amp.has_indexnow,false)             AS sig_has_indexnow,
  COALESCE(amp.has_internal_links,false)       AS sig_has_internal_links,
  COALESCE(amp.has_campaign_assets,false)      AS sig_has_campaign_assets,
  COALESCE(amp.has_distribution_targets,false) AS sig_has_distribution_targets,
  CASE
    WHEN COALESCE(ppr.seo_present,false)
     AND NOT COALESCE(canonical.has_canonical_drift,false)
     AND COALESCE(dead_end.dead_end_count,0) = 0 THEN 'ready'
    WHEN COALESCE(ppr.seo_present,false)
      OR NOT COALESCE(canonical.has_canonical_drift,false)
      OR COALESCE(dead_end.dead_end_count,0) = 0 THEN 'partial'
    ELSE 'missing'
  END AS visible_status,
  CASE
    WHEN COALESCE(ppr.tracking_pricing_view,false)
     AND COALESCE(ppr.tracking_checkout_started,false)
     AND COALESCE(ce.conversion_event_count,0) > 0 THEN 'ready'
    WHEN COALESCE(ppr.tracking_pricing_view,false)
      OR COALESCE(ppr.tracking_checkout_started,false)
      OR COALESCE(ce.conversion_event_count,0) > 0 THEN 'partial'
    ELSE 'missing'
  END AS instrumented_status,
  CASE
    WHEN ( (CASE WHEN COALESCE(amp.has_blog,false) THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(amp.has_og_image,false) THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(amp.has_indexnow,false) THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(amp.has_internal_links,false) THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(amp.has_campaign_assets,false) THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(amp.has_distribution_targets,false) THEN 1 ELSE 0 END)
         ) >= 5 THEN 'ready'
    WHEN ( (CASE WHEN COALESCE(amp.has_blog,false) THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(amp.has_og_image,false) THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(amp.has_indexnow,false) THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(amp.has_internal_links,false) THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(amp.has_campaign_assets,false) THEN 1 ELSE 0 END)
         + (CASE WHEN COALESCE(amp.has_distribution_targets,false) THEN 1 ELSE 0 END)
         ) >= 1 THEN 'partial'
    ELSE 'missing'
  END AS amplifiable_status,
  (
    COALESCE(ppr.seo_present,false)
    AND NOT COALESCE(canonical.has_canonical_drift,false)
    AND COALESCE(dead_end.dead_end_count,0) = 0
    AND COALESCE(ppr.tracking_pricing_view,false)
    AND COALESCE(ppr.tracking_checkout_started,false)
    AND COALESCE(ce.conversion_event_count,0) > 0
    AND ( (CASE WHEN COALESCE(amp.has_blog,false) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(amp.has_og_image,false) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(amp.has_indexnow,false) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(amp.has_internal_links,false) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(amp.has_campaign_assets,false) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(amp.has_distribution_targets,false) THEN 1 ELSE 0 END)
        ) >= 5
  ) AS growth_ready_v2,
  jsonb_build_object(
    'visible',      jsonb_build_object('seo_present', COALESCE(ppr.seo_present,false), 'canonical_ok', NOT COALESCE(canonical.has_canonical_drift,false), 'no_dead_end', COALESCE(dead_end.dead_end_count,0) = 0, 'seo_done_rows', COALESCE(ppr.seo_done_rows,0), 'seo_backlog_rows', COALESCE(ppr.seo_backlog_rows,0), 'dead_end_count', COALESCE(dead_end.dead_end_count,0)),
    'instrumented', jsonb_build_object('pricing_view', COALESCE(ppr.tracking_pricing_view,false), 'checkout_started', COALESCE(ppr.tracking_checkout_started,false), 'conversion_event_count', COALESCE(ce.conversion_event_count,0)),
    'amplifiable',  jsonb_build_object('blog', COALESCE(amp.has_blog,false), 'og_image', COALESCE(amp.has_og_image,false), 'indexnow', COALESCE(amp.has_indexnow,false), 'internal_links', COALESCE(amp.has_internal_links,false), 'campaign_assets', COALESCE(amp.has_campaign_assets,false), 'distribution_targets', COALESCE(amp.has_distribution_targets,false))
  ) AS signal_payload
FROM base b
LEFT JOIN ppr        ON ppr.package_id        = b.package_id
LEFT JOIN canonical  ON canonical.package_id  = b.package_id
LEFT JOIN dead_end   ON dead_end.package_id   = b.package_id
LEFT JOIN ce         ON ce.package_id         = b.package_id
LEFT JOIN amp        ON amp.package_id        = b.package_id;

REVOKE ALL ON public.v_package_growth_signals_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_package_growth_signals_v1 TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_growth_signals_summary()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  SELECT jsonb_build_object(
    'total_published',     COUNT(*),
    'growth_ready_v2',     COUNT(*) FILTER (WHERE growth_ready_v2),
    'visible_ready',       COUNT(*) FILTER (WHERE visible_status='ready'),
    'visible_partial',     COUNT(*) FILTER (WHERE visible_status='partial'),
    'visible_missing',     COUNT(*) FILTER (WHERE visible_status='missing'),
    'instrumented_ready',  COUNT(*) FILTER (WHERE instrumented_status='ready'),
    'instrumented_partial',COUNT(*) FILTER (WHERE instrumented_status='partial'),
    'instrumented_missing',COUNT(*) FILTER (WHERE instrumented_status='missing'),
    'amplifiable_ready',   COUNT(*) FILTER (WHERE amplifiable_status='ready'),
    'amplifiable_partial', COUNT(*) FILTER (WHERE amplifiable_status='partial'),
    'amplifiable_missing', COUNT(*) FILTER (WHERE amplifiable_status='missing'),
    'sig_visible', jsonb_build_object(
      'seo_present',  COUNT(*) FILTER (WHERE sig_seo_present),
      'canonical_ok', COUNT(*) FILTER (WHERE sig_canonical_ok),
      'no_dead_end',  COUNT(*) FILTER (WHERE sig_no_dead_end)
    ),
    'sig_instrumented', jsonb_build_object(
      'pricing_view',      COUNT(*) FILTER (WHERE sig_tracking_pricing_view),
      'checkout_started',  COUNT(*) FILTER (WHERE sig_tracking_checkout_started),
      'conversion_events', COUNT(*) FILTER (WHERE sig_conversion_events_present)
    ),
    'sig_amplifiable', jsonb_build_object(
      'blog',                 COUNT(*) FILTER (WHERE sig_has_blog),
      'og_image',             COUNT(*) FILTER (WHERE sig_has_og_image),
      'indexnow',             COUNT(*) FILTER (WHERE sig_has_indexnow),
      'internal_links',       COUNT(*) FILTER (WHERE sig_has_internal_links),
      'campaign_assets',      COUNT(*) FILTER (WHERE sig_has_campaign_assets),
      'distribution_targets', COUNT(*) FILTER (WHERE sig_has_distribution_targets)
    ),
    'generated_at', now()
  ) INTO v_result FROM public.v_package_growth_signals_v1;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_growth_signals_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_signals_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_growth_signals_packages(
  _visible_status text DEFAULT NULL, _instrumented_status text DEFAULT NULL,
  _amplifiable_status text DEFAULT NULL, _track text DEFAULT NULL, _limit int DEFAULT 100
)
RETURNS TABLE (
  package_id uuid, package_key text, package_title text, track text,
  visible_status text, instrumented_status text, amplifiable_status text,
  growth_ready_v2 boolean, signal_payload jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN QUERY
  SELECT v.package_id, v.package_key, v.package_title, v.track,
         v.visible_status, v.instrumented_status, v.amplifiable_status,
         v.growth_ready_v2, v.signal_payload
  FROM public.v_package_growth_signals_v1 v
  WHERE (_visible_status      IS NULL OR v.visible_status      = _visible_status)
    AND (_instrumented_status IS NULL OR v.instrumented_status = _instrumented_status)
    AND (_amplifiable_status  IS NULL OR v.amplifiable_status  = _amplifiable_status)
    AND (_track               IS NULL OR v.track               = _track)
  ORDER BY v.growth_ready_v2 ASC, v.package_title
  LIMIT GREATEST(1, LEAST(_limit, 500));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_growth_signals_packages(text,text,text,text,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_signals_packages(text,text,text,text,int) TO authenticated;

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES ('growth_signals_v1_init','system','success',
        jsonb_build_object('track','2.1','classes',ARRAY['visible','instrumented','amplifiable'],'mode','diagnose_only'));

NOTIFY pgrst, 'reload schema';