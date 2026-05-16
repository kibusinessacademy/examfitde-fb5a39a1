
DROP VIEW IF EXISTS public.v_growth_signal_classification_v1 CASCADE;
CREATE VIEW public.v_growth_signal_classification_v1 AS
WITH base AS (
  SELECT
    g.package_id, g.package_key, g.package_title, g.track,
    g.sig_seo_present, g.sig_canonical_ok, g.sig_no_dead_end,
    g.sig_tracking_pricing_view, g.sig_tracking_checkout_started, g.sig_conversion_events_present,
    g.sig_has_blog, g.sig_has_og_image, g.sig_has_indexnow,
    g.sig_has_internal_links, g.sig_has_campaign_assets, g.sig_has_distribution_targets
  FROM public.v_package_growth_signals_v1 g
),
tot AS ( SELECT COUNT(*)::numeric AS n FROM base ),
missing_pct AS (
  SELECT
    (COUNT(*) FILTER (WHERE NOT sig_seo_present))::numeric                / NULLIF((SELECT n FROM tot),0) AS pct_seo,
    (COUNT(*) FILTER (WHERE NOT sig_canonical_ok))::numeric               / NULLIF((SELECT n FROM tot),0) AS pct_canonical,
    (COUNT(*) FILTER (WHERE NOT sig_no_dead_end))::numeric                / NULLIF((SELECT n FROM tot),0) AS pct_dead_end,
    (COUNT(*) FILTER (WHERE NOT sig_tracking_pricing_view))::numeric      / NULLIF((SELECT n FROM tot),0) AS pct_pricing_view,
    (COUNT(*) FILTER (WHERE NOT sig_tracking_checkout_started))::numeric  / NULLIF((SELECT n FROM tot),0) AS pct_checkout_started,
    (COUNT(*) FILTER (WHERE NOT sig_conversion_events_present))::numeric  / NULLIF((SELECT n FROM tot),0) AS pct_events,
    (COUNT(*) FILTER (WHERE NOT sig_has_blog))::numeric                   / NULLIF((SELECT n FROM tot),0) AS pct_blog,
    (COUNT(*) FILTER (WHERE NOT sig_has_og_image))::numeric               / NULLIF((SELECT n FROM tot),0) AS pct_og,
    (COUNT(*) FILTER (WHERE NOT sig_has_indexnow))::numeric               / NULLIF((SELECT n FROM tot),0) AS pct_indexnow,
    (COUNT(*) FILTER (WHERE NOT sig_has_internal_links))::numeric         / NULLIF((SELECT n FROM tot),0) AS pct_links,
    (COUNT(*) FILTER (WHERE NOT sig_has_campaign_assets))::numeric        / NULLIF((SELECT n FROM tot),0) AS pct_campaign,
    (COUNT(*) FILTER (WHERE NOT sig_has_distribution_targets))::numeric   / NULLIF((SELECT n FROM tot),0) AS pct_distribution
  FROM base
),
signal_rows AS (
  SELECT b.package_id, b.package_key, b.package_title, b.track,
         s.signal, s.gap_pct
  FROM base b
  CROSS JOIN LATERAL (
    VALUES
      ('seo_present',           NOT b.sig_seo_present,               (SELECT pct_seo FROM missing_pct)),
      ('canonical_ok',          NOT b.sig_canonical_ok,              (SELECT pct_canonical FROM missing_pct)),
      ('no_dead_end',           NOT b.sig_no_dead_end,               (SELECT pct_dead_end FROM missing_pct)),
      ('tracking_pricing_view', NOT b.sig_tracking_pricing_view,     (SELECT pct_pricing_view FROM missing_pct)),
      ('tracking_checkout_started', NOT b.sig_tracking_checkout_started, (SELECT pct_checkout_started FROM missing_pct)),
      ('conversion_events',     NOT b.sig_conversion_events_present, (SELECT pct_events FROM missing_pct)),
      ('blog',                  NOT b.sig_has_blog,                  (SELECT pct_blog FROM missing_pct)),
      ('og_image',              NOT b.sig_has_og_image,              (SELECT pct_og FROM missing_pct)),
      ('indexnow',              NOT b.sig_has_indexnow,              (SELECT pct_indexnow FROM missing_pct)),
      ('internal_links',        NOT b.sig_has_internal_links,        (SELECT pct_links FROM missing_pct)),
      ('campaign_assets',       NOT b.sig_has_campaign_assets,       (SELECT pct_campaign FROM missing_pct)),
      ('distribution_targets',  NOT b.sig_has_distribution_targets,  (SELECT pct_distribution FROM missing_pct))
  ) AS s(signal, is_missing, gap_pct)
  WHERE s.is_missing
),
classified AS (
  SELECT
    r.package_id, r.package_key, r.package_title, r.track, r.signal,
    ROUND(r.gap_pct * 100)::int AS gap_pct_global,
    CASE WHEN r.gap_pct >= 0.80 THEN 'systemic' ELSE 'local' END AS scope,
    CASE
      WHEN r.signal = 'canonical_ok' AND r.gap_pct >= 0.80 THEN 'SYSTEMIC_PLATFORM_DRIFT'
      WHEN r.signal IN ('seo_present','no_dead_end','canonical_ok') THEN 'SEO_ARTIFACT_MISSING'
      WHEN r.signal = 'conversion_events'                  THEN 'TRACKING_NOT_EMITTED'
      WHEN r.signal IN ('tracking_pricing_view','tracking_checkout_started') THEN 'TRACKING_NOT_ATTRIBUTED'
      WHEN r.signal IN ('blog','og_image','indexnow','internal_links','campaign_assets','distribution_targets')
                                                           THEN 'FANOUT_NOT_STARTED'
      ELSE 'OBSERVABILITY_GAP'
    END AS class
  FROM signal_rows r
)
SELECT
  c.package_id, c.package_key, c.package_title, c.track,
  c.signal, c.scope, c.gap_pct_global, c.class,
  CASE
    WHEN c.class IN ('SYSTEMIC_PLATFORM_DRIFT','SEO_ARTIFACT_MISSING') THEN 'critical'
    WHEN c.class IN ('TRACKING_NOT_EMITTED','TRACKING_NOT_ATTRIBUTED','FANOUT_NOT_STARTED') THEN 'warn'
    ELSE 'info'
  END AS severity,
  CASE
    WHEN c.class = 'SYSTEMIC_PLATFORM_DRIFT' THEN false
    WHEN c.class = 'OBSERVABILITY_GAP'       THEN false
    WHEN c.class IN ('TRACKING_NOT_EMITTED','TRACKING_NOT_ATTRIBUTED','FANOUT_NOT_STARTED','SEO_ARTIFACT_MISSING') THEN true
    ELSE false
  END AS repairable
FROM classified c;

REVOKE ALL ON public.v_growth_signal_classification_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_growth_signal_classification_v1 TO service_role;

DROP VIEW IF EXISTS public.v_growth_classification_summary_v1 CASCADE;
CREATE VIEW public.v_growth_classification_summary_v1 AS
SELECT
  class, scope, severity, repairable,
  COUNT(*)::int                   AS signal_count,
  COUNT(DISTINCT package_id)::int AS package_count,
  MAX(gap_pct_global)             AS gap_pct_global
FROM public.v_growth_signal_classification_v1
GROUP BY class, scope, severity, repairable;

REVOKE ALL ON public.v_growth_classification_summary_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_growth_classification_summary_v1 TO service_role;

DROP FUNCTION IF EXISTS public.admin_get_growth_classification_summary();
CREATE OR REPLACE FUNCTION public.admin_get_growth_classification_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total int;
  v_classes jsonb;
  v_critical_systemic int;
  v_repairable_local int;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_total FROM public.v_package_growth_signals_v1;

  SELECT jsonb_agg(row ORDER BY sev_order, package_count DESC)
  INTO v_classes
  FROM (
    SELECT jsonb_build_object(
      'class', class, 'scope', scope, 'severity', severity, 'repairable', repairable,
      'signal_count', signal_count, 'package_count', package_count, 'gap_pct_global', gap_pct_global
    ) AS row,
    CASE severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END AS sev_order,
    package_count
    FROM public.v_growth_classification_summary_v1
  ) sub;

  SELECT COUNT(*) INTO v_critical_systemic
  FROM public.v_growth_classification_summary_v1
  WHERE severity = 'critical' AND scope = 'systemic';

  SELECT COALESCE(SUM(signal_count),0) INTO v_repairable_local
  FROM public.v_growth_classification_summary_v1
  WHERE repairable = true AND scope = 'local';

  RETURN jsonb_build_object(
    'total_published', v_total,
    'critical_systemic_classes', v_critical_systemic,
    'repairable_local_signals', v_repairable_local,
    'classes', COALESCE(v_classes, '[]'::jsonb),
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_growth_classification_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_classification_summary() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_get_growth_classification_signals(text, text, text, boolean, text, int);
CREATE OR REPLACE FUNCTION public.admin_get_growth_classification_signals(
  _class      text    DEFAULT NULL,
  _scope      text    DEFAULT NULL,
  _severity   text    DEFAULT NULL,
  _repairable boolean DEFAULT NULL,
  _track      text    DEFAULT NULL,
  _limit      int     DEFAULT 100
)
RETURNS TABLE (
  package_id uuid, package_key text, package_title text, track text,
  signal text, class text, scope text, severity text, repairable boolean,
  gap_pct_global int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT v.package_id, v.package_key, v.package_title, v.track,
         v.signal, v.class, v.scope, v.severity, v.repairable, v.gap_pct_global
  FROM public.v_growth_signal_classification_v1 v
  WHERE (_class      IS NULL OR v.class      = _class)
    AND (_scope      IS NULL OR v.scope      = _scope)
    AND (_severity   IS NULL OR v.severity   = _severity)
    AND (_repairable IS NULL OR v.repairable = _repairable)
    AND (_track      IS NULL OR v.track      = _track)
  ORDER BY
    CASE v.severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
    v.package_title NULLS LAST
  LIMIT COALESCE(_limit, 100);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_growth_classification_signals(text, text, text, boolean, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_classification_signals(text, text, text, boolean, text, int) TO authenticated, service_role;

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'growth_classification_v1_init',
  'system',
  'ok',
  jsonb_build_object(
    'view',  'v_growth_signal_classification_v1',
    'summary_view', 'v_growth_classification_summary_v1',
    'systemic_threshold_pct', 80,
    'classes', jsonb_build_array(
      'SYSTEMIC_PLATFORM_DRIFT','SEO_ARTIFACT_MISSING','TRACKING_NOT_EMITTED',
      'TRACKING_NOT_ATTRIBUTED','FANOUT_NOT_STARTED','OBSERVABILITY_GAP'
    ),
    'note', 'Track 2.2 diagnose-only. No auto-repair triggers wired.'
  )
);
