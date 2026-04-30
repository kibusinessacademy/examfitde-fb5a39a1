-- =====================================================================
-- 1. SSOT-View: Growth-Overview (Dashboard-Ampel)
-- =====================================================================
CREATE OR REPLACE VIEW public.v_seo_growth_overview AS
WITH cluster_stats AS (
  SELECT
    COUNT(*) AS total_clusters,
    COUNT(*) FILTER (WHERE status = 'active') AS active_clusters,
    COUNT(*) FILTER (WHERE pillar_page_url IS NOT NULL) AS clusters_with_pillar
  FROM public.seo_keyword_clusters
),
keyword_stats AS (
  SELECT
    COUNT(*) AS total_keywords,
    COUNT(*) FILTER (WHERE cluster_id IS NOT NULL) AS clustered_keywords,
    COUNT(*) FILTER (WHERE target_url IS NOT NULL) AS mapped_keywords,
    COALESCE(AVG(opportunity_score), 0)::numeric(5,2) AS avg_opportunity
  FROM public.seo_keywords
),
brief_stats AS (
  SELECT
    COUNT(*) AS total_briefs,
    COUNT(*) FILTER (WHERE status = 'draft') AS draft_briefs,
    COUNT(*) FILTER (WHERE status IN ('ready', 'ready_for_content')) AS ready_briefs,
    COUNT(*) FILTER (WHERE status = 'published') AS published_briefs
  FROM public.seo_content_briefs
),
page_stats AS (
  SELECT
    COUNT(*) AS total_pages,
    COUNT(*) FILTER (WHERE status = 'published') AS published_pages,
    COUNT(*) FILTER (WHERE status = 'draft') AS draft_pages
  FROM public.seo_content_pages
),
audit_stats AS (
  SELECT
    COUNT(*) AS total_audits,
    COUNT(*) FILTER (WHERE overall_score < 60) AS critical_audits,
    COUNT(*) FILTER (WHERE overall_score BETWEEN 60 AND 79) AS warning_audits,
    COUNT(*) FILTER (WHERE overall_score >= 80) AS healthy_audits,
    COALESCE(AVG(overall_score), 0)::int AS avg_score
  FROM public.seo_content_audits
),
refresh_stats AS (
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_refreshes,
    COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_refreshes,
    COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > now() - INTERVAL '7 days') AS completed_last_7d
  FROM public.seo_refresh_queue
)
SELECT
  cs.*, ks.*, bs.*, ps.*, aus.*, rs.*,
  -- Health-Ampel-Logik
  CASE
    WHEN ks.total_keywords = 0 THEN 'red'
    WHEN ks.clustered_keywords::float / NULLIF(ks.total_keywords, 0) < 0.5 THEN 'yellow'
    ELSE 'green'
  END AS keywords_health,
  CASE
    WHEN bs.total_briefs = 0 THEN 'red'
    WHEN bs.ready_briefs = 0 AND bs.draft_briefs > 5 THEN 'yellow'
    ELSE 'green'
  END AS briefs_health,
  CASE
    WHEN aus.critical_audits > 5 THEN 'red'
    WHEN aus.critical_audits > 0 OR aus.warning_audits > 10 THEN 'yellow'
    ELSE 'green'
  END AS audits_health,
  CASE
    WHEN rs.pending_refreshes > 20 THEN 'red'
    WHEN rs.pending_refreshes > 5 THEN 'yellow'
    ELSE 'green'
  END AS refresh_health,
  now() AS computed_at
FROM cluster_stats cs, keyword_stats ks, brief_stats bs, page_stats ps, audit_stats aus, refresh_stats rs;

GRANT SELECT ON public.v_seo_growth_overview TO authenticated;

-- =====================================================================
-- 2. SSOT-View: Conversion pro SEO-Page
-- =====================================================================
CREATE OR REPLACE VIEW public.v_seo_page_conversion AS
WITH page_paths AS (
  SELECT
    sd.id AS page_id,
    'seo_document' AS page_kind,
    sd.slug,
    sd.title,
    '/' || sd.slug AS page_path,
    sd.status,
    sd.published_at,
    sd.curriculum_id
  FROM public.seo_documents sd
  WHERE sd.status = 'published'
  UNION ALL
  SELECT
    scp.id, 'content_page', scp.slug, scp.title,
    '/' || scp.slug, scp.status, scp.updated_at, scp.curriculum_id
  FROM public.seo_content_pages scp
  WHERE scp.status = 'published'
),
ev_agg AS (
  SELECT
    page_path,
    COUNT(*) FILTER (WHERE event_type = 'page_view') AS views,
    COUNT(DISTINCT anonymous_id) FILTER (WHERE event_type = 'page_view') AS unique_visitors,
    COUNT(*) FILTER (WHERE event_type IN ('lead_magnet_view', 'lead_magnet_submit', 'quiz_started')) AS leads,
    COUNT(*) FILTER (WHERE event_type = 'checkout_started') AS checkout_starts,
    COUNT(*) FILTER (WHERE event_type = 'checkout_complete') AS paid_orders,
    COALESCE(SUM(((metadata->>'amount_eur')::numeric)) FILTER (WHERE event_type = 'checkout_complete'), 0)::numeric(10,2) AS revenue_eur
  FROM public.conversion_events
  WHERE created_at > now() - INTERVAL '90 days'
    AND page_path IS NOT NULL
  GROUP BY page_path
)
SELECT
  pp.page_id,
  pp.page_kind,
  pp.slug,
  pp.title,
  pp.page_path,
  pp.published_at,
  COALESCE(ev.views, 0) AS views_90d,
  COALESCE(ev.unique_visitors, 0) AS unique_visitors_90d,
  COALESCE(ev.leads, 0) AS leads_90d,
  COALESCE(ev.checkout_starts, 0) AS checkout_starts_90d,
  COALESCE(ev.paid_orders, 0) AS paid_orders_90d,
  COALESCE(ev.revenue_eur, 0) AS revenue_eur_90d,
  CASE
    WHEN COALESCE(ev.views, 0) = 0 THEN 0
    ELSE ROUND(COALESCE(ev.paid_orders, 0)::numeric * 100.0 / ev.views, 2)
  END AS conversion_rate_pct,
  CASE
    WHEN COALESCE(ev.views, 0) = 0 THEN 'no_traffic'
    WHEN COALESCE(ev.paid_orders, 0) >= 5 THEN 'top_performer'
    WHEN COALESCE(ev.leads, 0) >= 10 THEN 'lead_generator'
    WHEN COALESCE(ev.views, 0) >= 100 AND COALESCE(ev.paid_orders, 0) = 0 THEN 'leaky_funnel'
    ELSE 'low_signal'
  END AS performance_tier
FROM page_paths pp
LEFT JOIN ev_agg ev ON ev.page_path = pp.page_path;

GRANT SELECT ON public.v_seo_page_conversion TO authenticated;

-- =====================================================================
-- 3. SSOT-View: Refresh-Kandidaten mit Score
-- =====================================================================
CREATE OR REPLACE VIEW public.v_seo_refresh_candidates AS
WITH base AS (
  SELECT
    sd.id AS content_id,
    'seo_document' AS content_type,
    sd.slug,
    sd.title,
    '/' || sd.slug AS content_url,
    sd.published_at,
    EXTRACT(EPOCH FROM (now() - COALESCE(sd.published_at, sd.created_at))) / 86400.0 AS age_days
  FROM public.seo_documents sd
  WHERE sd.status = 'published'
),
with_audit AS (
  SELECT
    b.*,
    sca.overall_score,
    sca.refresh_risk_score,
    sca.audited_at
  FROM base b
  LEFT JOIN public.seo_content_audits sca
    ON sca.content_id = b.content_id AND sca.content_type = b.content_type
),
with_conversion AS (
  SELECT
    wa.*,
    vpc.views_90d,
    vpc.paid_orders_90d,
    vpc.performance_tier
  FROM with_audit wa
  LEFT JOIN public.v_seo_page_conversion vpc
    ON vpc.page_id = wa.content_id AND vpc.page_kind = wa.content_type
)
SELECT
  *,
  -- Refresh-Score 0..100, höher = dringender
  LEAST(100, GREATEST(0,
    -- Alter (max 30 Punkte)
    LEAST(30, (age_days / 180.0) * 30)::int
    -- Audit-Risk (max 30 Punkte)
    + COALESCE(refresh_risk_score, 0) / 100 * 30
    + CASE WHEN overall_score IS NOT NULL AND overall_score < 60 THEN 20 ELSE 0 END
    -- Performance-Signal (max 30 Punkte)
    + CASE
        WHEN performance_tier = 'leaky_funnel' THEN 25
        WHEN performance_tier = 'no_traffic' AND age_days > 90 THEN 20
        WHEN performance_tier = 'low_signal' THEN 10
        WHEN performance_tier = 'top_performer' THEN -10
        ELSE 0
      END
  ))::int AS refresh_score,
  CASE
    WHEN COALESCE(refresh_risk_score, 0) >= 70 THEN 'audit_critical'
    WHEN performance_tier = 'leaky_funnel' THEN 'high_traffic_no_conversion'
    WHEN age_days > 365 THEN 'stale_over_1y'
    WHEN performance_tier = 'no_traffic' THEN 'no_organic_pickup'
    WHEN overall_score IS NOT NULL AND overall_score < 60 THEN 'low_audit_score'
    ELSE 'general_refresh'
  END AS refresh_reason
FROM with_conversion;

GRANT SELECT ON public.v_seo_refresh_candidates TO authenticated;

-- =====================================================================
-- 4. SSOT-View: Recent Activity
-- =====================================================================
CREATE OR REPLACE VIEW public.v_seo_recent_activity AS
SELECT
  id,
  action_type,
  target_id,
  target_type,
  metadata,
  created_at,
  CASE
    WHEN action_type LIKE '%audit%' THEN 'audit'
    WHEN action_type LIKE '%brief%' THEN 'brief'
    WHEN action_type LIKE '%refresh%' THEN 'refresh'
    WHEN action_type LIKE '%discover%' THEN 'discovery'
    WHEN action_type LIKE '%keyword%' THEN 'keyword'
    WHEN action_type LIKE '%cluster%' THEN 'cluster'
    ELSE 'other'
  END AS activity_kind
FROM public.auto_heal_log
WHERE action_type LIKE 'seo_%'
ORDER BY created_at DESC
LIMIT 100;

GRANT SELECT ON public.v_seo_recent_activity TO authenticated;

-- =====================================================================
-- 5. RPC: Compute Overview (für Card-Header)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_seo_compute_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_overview jsonb;
  v_top_refresh jsonb;
  v_top_pages jsonb;
  v_recent jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT to_jsonb(o) INTO v_overview FROM public.v_seo_growth_overview o LIMIT 1;

  SELECT jsonb_agg(t) INTO v_top_refresh FROM (
    SELECT slug, title, refresh_score, refresh_reason, content_url
    FROM public.v_seo_refresh_candidates
    ORDER BY refresh_score DESC NULLS LAST
    LIMIT 10
  ) t;

  SELECT jsonb_agg(t) INTO v_top_pages FROM (
    SELECT slug, title, views_90d, paid_orders_90d, revenue_eur_90d, performance_tier
    FROM public.v_seo_page_conversion
    ORDER BY revenue_eur_90d DESC NULLS LAST, views_90d DESC NULLS LAST
    LIMIT 10
  ) t;

  SELECT jsonb_agg(t) INTO v_recent FROM (
    SELECT activity_kind, action_type, target_id, metadata, created_at
    FROM public.v_seo_recent_activity LIMIT 20
  ) t;

  RETURN jsonb_build_object(
    'overview', COALESCE(v_overview, '{}'::jsonb),
    'top_refresh_candidates', COALESCE(v_top_refresh, '[]'::jsonb),
    'top_pages', COALESCE(v_top_pages, '[]'::jsonb),
    'recent_activity', COALESCE(v_recent, '[]'::jsonb),
    'computed_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_seo_compute_overview() TO authenticated;

-- =====================================================================
-- 6. RPC: Top-N Refresh-Kandidaten in Queue schieben (idempotent)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_seo_enqueue_refresh_top_n(p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted int := 0;
  v_skipped int := 0;
  v_row record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  FOR v_row IN
    SELECT * FROM public.v_seo_refresh_candidates
    WHERE refresh_score >= 50
    ORDER BY refresh_score DESC
    LIMIT GREATEST(1, LEAST(p_limit, 50))
  LOOP
    -- Skip wenn schon pending/in_progress
    IF EXISTS (
      SELECT 1 FROM public.seo_refresh_queue
      WHERE content_id = v_row.content_id
        AND content_type = v_row.content_type
        AND status IN ('pending', 'in_progress')
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.seo_refresh_queue
      (content_type, content_id, content_url, content_title, reason, priority, suggested_actions, status)
    VALUES (
      v_row.content_type, v_row.content_id, v_row.content_url, v_row.title,
      v_row.refresh_reason,
      CASE WHEN v_row.refresh_score >= 80 THEN 1 WHEN v_row.refresh_score >= 65 THEN 3 ELSE 5 END,
      jsonb_build_object('score', v_row.refresh_score, 'tier', v_row.performance_tier),
      'pending'
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, metadata)
  VALUES ('seo_refresh_top_n_enqueued', NULL, 'seo_refresh_queue',
          jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'limit', p_limit, 'caller', auth.uid()));

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_seo_enqueue_refresh_top_n(int) TO authenticated;

-- =====================================================================
-- 7. RPC: Brief in Pipeline-Queue schieben
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_seo_brief_to_queue(p_brief_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_brief record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT * INTO v_brief FROM public.seo_content_briefs WHERE id = p_brief_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'brief_not_found');
  END IF;

  IF v_brief.generated_brief_md IS NULL OR length(v_brief.generated_brief_md) < 100 THEN
    RETURN jsonb_build_object('error', 'brief_not_generated', 'hint', 'run generate-seo-brief first');
  END IF;

  UPDATE public.seo_content_briefs
  SET status = 'ready_for_content', updated_at = now()
  WHERE id = p_brief_id;

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, metadata)
  VALUES ('seo_brief_marked_ready', p_brief_id::text, 'seo_content_brief',
          jsonb_build_object('title', v_brief.title, 'caller', auth.uid()));

  RETURN jsonb_build_object('ok', true, 'brief_id', p_brief_id, 'status', 'ready_for_content');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_seo_brief_to_queue(uuid) TO authenticated;