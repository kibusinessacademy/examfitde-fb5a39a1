
-- ============================================================
-- Funnel-Analytics-Layer Phase 1
-- 3 Views (24h/7d/30d) + 2 SECURITY DEFINER RPCs (Admin-Gate)
-- ============================================================

-- Helper macro nicht nötig — Views inline mit Zeitfenster.

-- ---------- VIEW 24h ----------
CREATE OR REPLACE VIEW public.v_funnel_conversion_24h AS
WITH base AS (
  SELECT
    COALESCE(
      package_id,
      NULLIF(metadata->>'package_id', '')::uuid
    ) AS package_id,
    COALESCE(
      NULLIF(metadata->>'persona_type', ''),
      NULLIF(metadata->>'persona', ''),
      'unknown'
    ) AS persona_type,
    COALESCE(page_path, metadata->>'source_page', 'unknown') AS source_page,
    event_type,
    created_at
  FROM public.conversion_events
  WHERE created_at >= now() - interval '24 hours'
    AND COALESCE((metadata->>'smoke_test')::boolean, false) = false
),
agg AS (
  SELECT
    package_id,
    persona_type,
    source_page,
    COUNT(*) FILTER (WHERE event_type = 'landing_view')                AS landing_views,
    COUNT(*) FILTER (WHERE event_type = 'lead_magnet_view')            AS lead_magnet_views,
    COUNT(*) FILTER (WHERE event_type = 'lead_gate_shown')             AS lead_gate_shown,
    COUNT(*) FILTER (WHERE event_type = 'lead_gate_start_diagnosis')   AS lead_gate_start_diagnosis,
    COUNT(*) FILTER (WHERE event_type = 'lead_gate_skip_to_checkout')  AS lead_gate_skip_to_checkout,
    COUNT(*) FILTER (WHERE event_type = 'quiz_started')                AS quiz_starts,
    COUNT(*) FILTER (WHERE event_type = 'quiz_completed')              AS quiz_completions,
    COUNT(*) FILTER (WHERE event_type = 'quiz_result_viewed')          AS result_views,
    COUNT(*) FILTER (WHERE event_type = 'result_cta_clicked')          AS result_cta_clicks,
    COUNT(*) FILTER (WHERE event_type IN ('checkout_started','checkout_start')) AS checkout_starts,
    COUNT(*) FILTER (WHERE event_type IN ('checkout_complete','checkout_completed')) AS checkouts_completed,
    COUNT(*) FILTER (WHERE package_id IS NULL)                         AS orphan_events_count
  FROM base
  GROUP BY package_id, persona_type, source_page
)
SELECT
  a.package_id,
  cp.package_key,
  cp.title AS package_title,
  a.persona_type,
  a.source_page,
  a.landing_views,
  a.lead_magnet_views,
  a.lead_gate_shown,
  a.lead_gate_start_diagnosis,
  a.lead_gate_skip_to_checkout,
  a.quiz_starts,
  a.quiz_completions,
  a.result_views,
  a.result_cta_clicks,
  a.checkout_starts,
  a.checkouts_completed,
  a.orphan_events_count,
  ROUND((a.quiz_starts::numeric         / NULLIF(a.landing_views, 0))     * 100, 2) AS landing_to_quiz_rate,
  ROUND((a.quiz_completions::numeric    / NULLIF(a.quiz_starts, 0))       * 100, 2) AS quiz_completion_rate,
  ROUND((a.result_views::numeric        / NULLIF(a.quiz_completions, 0))  * 100, 2) AS quiz_to_result_rate,
  ROUND((a.checkout_starts::numeric     / NULLIF(a.result_views, 0))      * 100, 2) AS result_to_checkout_rate,
  ROUND((a.checkouts_completed::numeric / NULLIF(a.checkout_starts, 0))   * 100, 2) AS checkout_completion_rate,
  ROUND((a.checkouts_completed::numeric / NULLIF(a.landing_views, 0))     * 100, 2) AS full_funnel_conversion_rate
FROM agg a
LEFT JOIN public.course_packages cp ON cp.id = a.package_id
WHERE a.package_id IS NOT NULL;

-- ---------- VIEW 7d ----------
CREATE OR REPLACE VIEW public.v_funnel_conversion_7d AS
WITH base AS (
  SELECT
    COALESCE(package_id, NULLIF(metadata->>'package_id', '')::uuid) AS package_id,
    COALESCE(NULLIF(metadata->>'persona_type', ''), NULLIF(metadata->>'persona', ''), 'unknown') AS persona_type,
    COALESCE(page_path, metadata->>'source_page', 'unknown') AS source_page,
    event_type, created_at
  FROM public.conversion_events
  WHERE created_at >= now() - interval '7 days'
    AND COALESCE((metadata->>'smoke_test')::boolean, false) = false
),
agg AS (
  SELECT
    package_id, persona_type, source_page,
    COUNT(*) FILTER (WHERE event_type = 'landing_view')                AS landing_views,
    COUNT(*) FILTER (WHERE event_type = 'lead_magnet_view')            AS lead_magnet_views,
    COUNT(*) FILTER (WHERE event_type = 'lead_gate_shown')             AS lead_gate_shown,
    COUNT(*) FILTER (WHERE event_type = 'lead_gate_start_diagnosis')   AS lead_gate_start_diagnosis,
    COUNT(*) FILTER (WHERE event_type = 'lead_gate_skip_to_checkout')  AS lead_gate_skip_to_checkout,
    COUNT(*) FILTER (WHERE event_type = 'quiz_started')                AS quiz_starts,
    COUNT(*) FILTER (WHERE event_type = 'quiz_completed')              AS quiz_completions,
    COUNT(*) FILTER (WHERE event_type = 'quiz_result_viewed')          AS result_views,
    COUNT(*) FILTER (WHERE event_type = 'result_cta_clicked')          AS result_cta_clicks,
    COUNT(*) FILTER (WHERE event_type IN ('checkout_started','checkout_start')) AS checkout_starts,
    COUNT(*) FILTER (WHERE event_type IN ('checkout_complete','checkout_completed')) AS checkouts_completed,
    COUNT(*) FILTER (WHERE package_id IS NULL)                         AS orphan_events_count
  FROM base
  GROUP BY package_id, persona_type, source_page
)
SELECT
  a.package_id, cp.package_key, cp.title AS package_title, a.persona_type, a.source_page,
  a.landing_views, a.lead_magnet_views, a.lead_gate_shown, a.lead_gate_start_diagnosis,
  a.lead_gate_skip_to_checkout, a.quiz_starts, a.quiz_completions, a.result_views,
  a.result_cta_clicks, a.checkout_starts, a.checkouts_completed, a.orphan_events_count,
  ROUND((a.quiz_starts::numeric         / NULLIF(a.landing_views, 0))     * 100, 2) AS landing_to_quiz_rate,
  ROUND((a.quiz_completions::numeric    / NULLIF(a.quiz_starts, 0))       * 100, 2) AS quiz_completion_rate,
  ROUND((a.result_views::numeric        / NULLIF(a.quiz_completions, 0))  * 100, 2) AS quiz_to_result_rate,
  ROUND((a.checkout_starts::numeric     / NULLIF(a.result_views, 0))      * 100, 2) AS result_to_checkout_rate,
  ROUND((a.checkouts_completed::numeric / NULLIF(a.checkout_starts, 0))   * 100, 2) AS checkout_completion_rate,
  ROUND((a.checkouts_completed::numeric / NULLIF(a.landing_views, 0))     * 100, 2) AS full_funnel_conversion_rate
FROM agg a
LEFT JOIN public.course_packages cp ON cp.id = a.package_id
WHERE a.package_id IS NOT NULL;

-- ---------- VIEW 30d ----------
CREATE OR REPLACE VIEW public.v_funnel_conversion_30d AS
WITH base AS (
  SELECT
    COALESCE(package_id, NULLIF(metadata->>'package_id', '')::uuid) AS package_id,
    COALESCE(NULLIF(metadata->>'persona_type', ''), NULLIF(metadata->>'persona', ''), 'unknown') AS persona_type,
    COALESCE(page_path, metadata->>'source_page', 'unknown') AS source_page,
    event_type, created_at
  FROM public.conversion_events
  WHERE created_at >= now() - interval '30 days'
    AND COALESCE((metadata->>'smoke_test')::boolean, false) = false
),
agg AS (
  SELECT
    package_id, persona_type, source_page,
    COUNT(*) FILTER (WHERE event_type = 'landing_view')                AS landing_views,
    COUNT(*) FILTER (WHERE event_type = 'lead_magnet_view')            AS lead_magnet_views,
    COUNT(*) FILTER (WHERE event_type = 'lead_gate_shown')             AS lead_gate_shown,
    COUNT(*) FILTER (WHERE event_type = 'lead_gate_start_diagnosis')   AS lead_gate_start_diagnosis,
    COUNT(*) FILTER (WHERE event_type = 'lead_gate_skip_to_checkout')  AS lead_gate_skip_to_checkout,
    COUNT(*) FILTER (WHERE event_type = 'quiz_started')                AS quiz_starts,
    COUNT(*) FILTER (WHERE event_type = 'quiz_completed')              AS quiz_completions,
    COUNT(*) FILTER (WHERE event_type = 'quiz_result_viewed')          AS result_views,
    COUNT(*) FILTER (WHERE event_type = 'result_cta_clicked')          AS result_cta_clicks,
    COUNT(*) FILTER (WHERE event_type IN ('checkout_started','checkout_start')) AS checkout_starts,
    COUNT(*) FILTER (WHERE event_type IN ('checkout_complete','checkout_completed')) AS checkouts_completed,
    COUNT(*) FILTER (WHERE package_id IS NULL)                         AS orphan_events_count
  FROM base
  GROUP BY package_id, persona_type, source_page
)
SELECT
  a.package_id, cp.package_key, cp.title AS package_title, a.persona_type, a.source_page,
  a.landing_views, a.lead_magnet_views, a.lead_gate_shown, a.lead_gate_start_diagnosis,
  a.lead_gate_skip_to_checkout, a.quiz_starts, a.quiz_completions, a.result_views,
  a.result_cta_clicks, a.checkout_starts, a.checkouts_completed, a.orphan_events_count,
  ROUND((a.quiz_starts::numeric         / NULLIF(a.landing_views, 0))     * 100, 2) AS landing_to_quiz_rate,
  ROUND((a.quiz_completions::numeric    / NULLIF(a.quiz_starts, 0))       * 100, 2) AS quiz_completion_rate,
  ROUND((a.result_views::numeric        / NULLIF(a.quiz_completions, 0))  * 100, 2) AS quiz_to_result_rate,
  ROUND((a.checkout_starts::numeric     / NULLIF(a.result_views, 0))      * 100, 2) AS result_to_checkout_rate,
  ROUND((a.checkouts_completed::numeric / NULLIF(a.checkout_starts, 0))   * 100, 2) AS checkout_completion_rate,
  ROUND((a.checkouts_completed::numeric / NULLIF(a.landing_views, 0))     * 100, 2) AS full_funnel_conversion_rate
FROM agg a
LEFT JOIN public.course_packages cp ON cp.id = a.package_id
WHERE a.package_id IS NOT NULL;

-- ---------- Sicherheit: Admin-View-Contract ----------
REVOKE ALL ON public.v_funnel_conversion_24h FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_funnel_conversion_7d  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_funnel_conversion_30d FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_funnel_conversion_24h TO service_role;
GRANT SELECT ON public.v_funnel_conversion_7d  TO service_role;
GRANT SELECT ON public.v_funnel_conversion_30d TO service_role;

-- ---------- RPC: admin_get_funnel_conversion ----------
CREATE OR REPLACE FUNCTION public.admin_get_funnel_conversion(
  p_window text DEFAULT '7d',
  p_limit  int  DEFAULT 200
)
RETURNS TABLE(
  package_id uuid,
  package_key text,
  package_title text,
  persona_type text,
  source_page text,
  landing_views bigint,
  lead_magnet_views bigint,
  lead_gate_shown bigint,
  lead_gate_start_diagnosis bigint,
  lead_gate_skip_to_checkout bigint,
  quiz_starts bigint,
  quiz_completions bigint,
  result_views bigint,
  result_cta_clicks bigint,
  checkout_starts bigint,
  checkouts_completed bigint,
  orphan_events_count bigint,
  landing_to_quiz_rate numeric,
  quiz_completion_rate numeric,
  quiz_to_result_rate numeric,
  result_to_checkout_rate numeric,
  checkout_completion_rate numeric,
  full_funnel_conversion_rate numeric,
  traffic_light text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'access denied: admin role required' USING ERRCODE = '42501';
  END IF;

  IF p_window NOT IN ('24h','7d','30d') THEN
    RAISE EXCEPTION 'invalid window: must be one of 24h, 7d, 30d' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY EXECUTE format($q$
    SELECT
      v.package_id, v.package_key, v.package_title, v.persona_type, v.source_page,
      v.landing_views, v.lead_magnet_views, v.lead_gate_shown,
      v.lead_gate_start_diagnosis, v.lead_gate_skip_to_checkout,
      v.quiz_starts, v.quiz_completions, v.result_views, v.result_cta_clicks,
      v.checkout_starts, v.checkouts_completed, v.orphan_events_count,
      v.landing_to_quiz_rate, v.quiz_completion_rate, v.quiz_to_result_rate,
      v.result_to_checkout_rate, v.checkout_completion_rate, v.full_funnel_conversion_rate,
      CASE
        WHEN v.full_funnel_conversion_rate >= 3 THEN 'green'
        WHEN v.full_funnel_conversion_rate >= 1 THEN 'yellow'
        WHEN v.landing_views >= 20 AND COALESCE(v.full_funnel_conversion_rate,0) < 1 THEN 'red'
        ELSE 'gray'
      END AS traffic_light
    FROM public.%I v
    ORDER BY v.landing_views DESC NULLS LAST, v.full_funnel_conversion_rate DESC NULLS LAST
    LIMIT %L
  $q$, 'v_funnel_conversion_' || p_window, p_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_funnel_conversion(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_funnel_conversion(text,int) TO authenticated;

-- ---------- RPC: admin_get_funnel_orphan_summary ----------
CREATE OR REPLACE FUNCTION public.admin_get_funnel_orphan_summary(
  p_window text DEFAULT '7d'
)
RETURNS TABLE(
  event_type text,
  orphan_count bigint,
  first_seen timestamptz,
  last_seen timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'access denied: admin role required' USING ERRCODE = '42501';
  END IF;

  v_since := CASE p_window
    WHEN '24h' THEN now() - interval '24 hours'
    WHEN '7d'  THEN now() - interval '7 days'
    WHEN '30d' THEN now() - interval '30 days'
    ELSE NULL
  END;

  IF v_since IS NULL THEN
    RAISE EXCEPTION 'invalid window' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    SELECT
      ce.event_type,
      COUNT(*)::bigint AS orphan_count,
      MIN(ce.created_at) AS first_seen,
      MAX(ce.created_at) AS last_seen
    FROM public.conversion_events ce
    WHERE ce.created_at >= v_since
      AND ce.package_id IS NULL
      AND NULLIF(ce.metadata->>'package_id','') IS NULL
      AND COALESCE((ce.metadata->>'smoke_test')::boolean, false) = false
    GROUP BY ce.event_type
    ORDER BY orphan_count DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_funnel_orphan_summary(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_funnel_orphan_summary(text) TO authenticated;

COMMENT ON VIEW public.v_funnel_conversion_7d IS
  'Funnel-Analytics SSOT (7d). Admin-only — Zugriff nur über admin_get_funnel_conversion(p_window=>''7d'').';
COMMENT ON FUNCTION public.admin_get_funnel_conversion(text,int) IS
  'Admin-only Funnel-KPIs pro package_id × persona_type × source_page mit Ampel.';
