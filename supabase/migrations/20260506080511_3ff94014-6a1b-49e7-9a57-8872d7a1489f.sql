-- SSOT: CTA Performance per location/variant — basis for A/B + winner detection
DROP VIEW IF EXISTS public.v_conversion_cta_performance CASCADE;

CREATE VIEW public.v_conversion_cta_performance AS
WITH cta_events AS (
  SELECT
    COALESCE(NULLIF(metadata->>'page_path',''), page_path) AS page_path,
    COALESCE(NULLIF(metadata->>'source',''), 'generic')    AS source,
    COALESCE(NULLIF(metadata->>'cta_location',''), 'unknown') AS cta_location,
    COALESCE(NULLIF(metadata->>'variant',''), 'A')         AS variant,
    NULLIF(metadata->>'quiz_slug','')                       AS quiz_slug,
    session_id,
    event_type,
    created_at
  FROM public.conversion_events
  WHERE created_at > now() - interval '7 days'
    AND event_type IN ('cta_visible','cta_clicked','lead_magnet_view','quiz_cta_clicked')
),
agg AS (
  SELECT
    page_path, source, cta_location, variant,
    COUNT(*) FILTER (WHERE event_type = 'cta_visible')      AS views,
    COUNT(*) FILTER (WHERE event_type IN ('cta_clicked','quiz_cta_clicked')) AS clicks,
    array_agg(DISTINCT session_id) FILTER (WHERE event_type IN ('cta_clicked','quiz_cta_clicked') AND session_id IS NOT NULL) AS click_sessions
  FROM cta_events
  GROUP BY 1,2,3,4
),
quiz_starts AS (
  SELECT session_id, COUNT(*) AS n
  FROM public.conversion_events
  WHERE created_at > now() - interval '7 days'
    AND event_type = 'quiz_started'
    AND session_id IS NOT NULL
  GROUP BY session_id
),
checkout_starts AS (
  SELECT session_id, COUNT(*) AS n
  FROM public.conversion_events
  WHERE created_at > now() - interval '7 days'
    AND event_type IN ('checkout_start','checkout_started')
    AND session_id IS NOT NULL
  GROUP BY session_id
)
SELECT
  a.page_path,
  a.source,
  a.cta_location,
  a.variant,
  a.views,
  a.clicks,
  CASE WHEN a.views > 0 THEN ROUND((a.clicks::numeric / a.views) * 100, 2) ELSE 0 END AS ctr_pct,
  COALESCE((SELECT SUM(qs.n)::int FROM quiz_starts qs WHERE qs.session_id = ANY(a.click_sessions)), 0) AS quiz_started,
  CASE WHEN a.clicks > 0
       THEN ROUND((COALESCE((SELECT SUM(qs.n) FROM quiz_starts qs WHERE qs.session_id = ANY(a.click_sessions)),0)::numeric / a.clicks) * 100, 2)
       ELSE 0 END AS quiz_start_rate_pct,
  COALESCE((SELECT SUM(cs.n)::int FROM checkout_starts cs WHERE cs.session_id = ANY(a.click_sessions)), 0) AS checkout_started,
  CASE WHEN a.clicks > 0
       THEN ROUND((COALESCE((SELECT SUM(cs.n) FROM checkout_starts cs WHERE cs.session_id = ANY(a.click_sessions)),0)::numeric / a.clicks) * 100, 2)
       ELSE 0 END AS checkout_rate_pct
FROM agg a
ORDER BY a.cta_location, a.variant;

REVOKE ALL ON public.v_conversion_cta_performance FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_conversion_cta_performance TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_cta_performance()
RETURNS SETOF public.v_conversion_cta_performance
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.v_conversion_cta_performance
  WHERE public.has_role(auth.uid(), 'admin'::app_role);
$$;

REVOKE ALL ON FUNCTION public.admin_get_cta_performance() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_cta_performance() TO authenticated;

NOTIFY pgrst, 'reload schema';