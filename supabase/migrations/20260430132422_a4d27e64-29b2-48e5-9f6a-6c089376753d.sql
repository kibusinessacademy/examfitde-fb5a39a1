CREATE OR REPLACE VIEW public.v_funnel_integrity_check
WITH (security_invoker = on) AS
WITH window_events AS (
  SELECT event_type, metadata, page_path, user_id, anonymous_id, created_at
  FROM public.conversion_events
  WHERE created_at > now() - interval '7 days'
    AND event_type IN ('lead_magnet_view','quiz_started','quiz_completed','lead_capture_submitted','checkout_complete')
),
per_event AS (
  SELECT
    event_type,
    count(*)::int AS total,
    count(*) FILTER (WHERE (metadata ? 'package_id') AND (metadata->>'package_id') ~ '^[0-9a-f-]{36}$')::int AS with_package_id,
    count(*) FILTER (WHERE (metadata ? 'persona') AND length(metadata->>'persona') > 0)::int AS with_persona,
    count(*) FILTER (WHERE page_path IS NOT NULL OR (metadata ? 'source_page' AND length(metadata->>'source_page') > 0))::int AS with_source
  FROM window_events
  GROUP BY 1
),
totals AS (
  SELECT
    coalesce(sum(total),0)::int AS events_total_7d,
    coalesce(sum(with_persona),0)::int AS with_persona_total,
    coalesce(sum(with_source),0)::int AS with_source_total,
    coalesce(sum(total) FILTER (WHERE event_type IN ('quiz_started','quiz_completed','lead_capture_submitted','checkout_complete')),0)::int AS strict_events_total,
    coalesce(sum(with_package_id) FILTER (WHERE event_type IN ('quiz_started','quiz_completed','lead_capture_submitted','checkout_complete')),0)::int AS strict_events_with_pkg,
    bool_or(event_type='lead_magnet_view') AS has_lead_magnet_view,
    bool_or(event_type='quiz_started') AS has_quiz_started,
    bool_or(event_type='quiz_completed') AS has_quiz_completed,
    bool_or(event_type='lead_capture_submitted') AS has_lead_capture,
    bool_or(event_type='checkout_complete') AS has_checkout_complete
  FROM per_event
),
funnel_drops AS (
  SELECT
    coalesce(sum(total) FILTER (WHERE event_type='lead_magnet_view'),0)::int AS s1_lead_magnet,
    coalesce(sum(total) FILTER (WHERE event_type='quiz_started'),0)::int AS s2_quiz_started,
    coalesce(sum(total) FILTER (WHERE event_type='quiz_completed'),0)::int AS s3_quiz_completed,
    coalesce(sum(total) FILTER (WHERE event_type='lead_capture_submitted'),0)::int AS s4_lead_capture,
    coalesce(sum(total) FILTER (WHERE event_type='checkout_complete'),0)::int AS s5_checkout
  FROM per_event
),
sub AS (
  SELECT
    t.*,
    fd.s1_lead_magnet, fd.s2_quiz_started, fd.s3_quiz_completed, fd.s4_lead_capture, fd.s5_checkout,
    CASE
      WHEN t.strict_events_total = 0 THEN 'yellow'
      WHEN t.strict_events_with_pkg::float / NULLIF(t.strict_events_total,0) >= 0.95 THEN 'green'
      WHEN t.strict_events_with_pkg::float / NULLIF(t.strict_events_total,0) >= 0.50 THEN 'yellow'
      ELSE 'red'
    END AS s_tracking,
    CASE
      WHEN NOT (t.has_lead_magnet_view AND t.has_quiz_started AND t.has_quiz_completed AND t.has_lead_capture) THEN 'red'
      WHEN NOT t.has_checkout_complete THEN 'yellow'
      WHEN fd.s3_quiz_completed > 5 AND fd.s4_lead_capture::float / fd.s3_quiz_completed < 0.30 THEN 'yellow'
      ELSE 'green'
    END AS s_continuity,
    CASE
      WHEN t.events_total_7d = 0 THEN 'yellow'
      WHEN t.with_source_total::float / t.events_total_7d >= 0.90
       AND t.with_persona_total::float / t.events_total_7d >= 0.50 THEN 'green'
      WHEN t.with_source_total::float / t.events_total_7d >= 0.50 THEN 'yellow'
      ELSE 'red'
    END AS s_attribution
  FROM totals t, funnel_drops fd
)
SELECT
  strict_events_total,
  strict_events_with_pkg,
  CASE WHEN strict_events_total = 0 THEN 100::numeric(5,1)
       ELSE round(100.0 * strict_events_with_pkg / strict_events_total, 1)
  END AS tracking_completeness_pct,
  s_tracking AS tracking_completeness_status,
  s1_lead_magnet, s2_quiz_started, s3_quiz_completed, s4_lead_capture, s5_checkout,
  s_continuity AS funnel_continuity_status,
  with_persona_total, with_source_total,
  CASE WHEN events_total_7d = 0 THEN 100::numeric(5,1)
       ELSE round(100.0 * with_persona_total / events_total_7d, 1)
  END AS persona_coverage_pct,
  CASE WHEN events_total_7d = 0 THEN 100::numeric(5,1)
       ELSE round(100.0 * with_source_total / events_total_7d, 1)
  END AS source_coverage_pct,
  s_attribution AS attribution_quality_status,
  events_total_7d,
  CASE
    WHEN events_total_7d = 0 THEN 'red'
    WHEN 'red' IN (s_tracking, s_continuity, s_attribution) THEN 'red'
    WHEN 'yellow' IN (s_tracking, s_continuity, s_attribution) THEN 'yellow'
    ELSE 'green'
  END AS status,
  now() AS checked_at
FROM sub;

REVOKE ALL ON public.v_funnel_integrity_check FROM PUBLIC;
REVOKE ALL ON public.v_funnel_integrity_check FROM anon;
GRANT SELECT ON public.v_funnel_integrity_check TO authenticated;
GRANT SELECT ON public.v_funnel_integrity_check TO service_role;

COMMENT ON VIEW public.v_funnel_integrity_check IS
'Tiered Funnel-Integrity-Guard v1: tracking_completeness/funnel_continuity/attribution_quality über conversion_events letzte 7 Tage. Master-Status = schlechteste Sub-Ampel.';

CREATE OR REPLACE VIEW public.v_platform_integrity
WITH (security_invoker = on) AS
WITH pricing AS (
  SELECT status AS pricing_status, published_without_price, duplicate_product_cases,
         manual_review_cases, total_published_packages
  FROM public.v_pricing_integrity_check
),
funnel AS (
  SELECT status AS funnel_status, tracking_completeness_status, funnel_continuity_status,
         attribution_quality_status, events_total_7d, tracking_completeness_pct
  FROM public.v_funnel_integrity_check
),
publish AS (
  SELECT
    count(*)::int AS published_packages_total,
    count(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM public.seo_content_pages s
        WHERE s.package_id = cp.id AND s.status = 'published'
      )
    )::int AS published_without_seo_page
  FROM public.course_packages cp
  WHERE cp.status='published' AND cp.is_published=true
),
seo AS (
  SELECT
    pub.published_packages_total,
    pub.published_without_seo_page,
    CASE WHEN pub.published_without_seo_page = 0 THEN 'green'
         WHEN pub.published_without_seo_page <= 2 THEN 'yellow'
         ELSE 'red' END AS seo_publish_status
  FROM publish pub
)
SELECT
  p.pricing_status, p.published_without_price, p.total_published_packages,
  f.funnel_status, f.tracking_completeness_status, f.funnel_continuity_status,
  f.attribution_quality_status, f.events_total_7d, f.tracking_completeness_pct,
  s.published_without_seo_page, s.seo_publish_status,
  CASE
    WHEN 'red' IN (p.pricing_status, f.funnel_status, s.seo_publish_status) THEN 'red'
    WHEN 'yellow' IN (p.pricing_status, f.funnel_status, s.seo_publish_status) THEN 'yellow'
    ELSE 'green'
  END AS platform_status,
  now() AS checked_at
FROM pricing p, funnel f, seo s;

REVOKE ALL ON public.v_platform_integrity FROM PUBLIC;
REVOKE ALL ON public.v_platform_integrity FROM anon;
GRANT SELECT ON public.v_platform_integrity TO authenticated;
GRANT SELECT ON public.v_platform_integrity TO service_role;

COMMENT ON VIEW public.v_platform_integrity IS
'Master-Health-View: aggregiert pricing/funnel/seo_publish zu platform_status. Schlechteste Domain-Ampel gewinnt.';