
DROP VIEW IF EXISTS public.v_platform_integrity;
DROP VIEW IF EXISTS public.v_package_e2e_integrity;

-- v2: Mapping-based readiness (NOT traffic-based)
CREATE VIEW public.v_package_e2e_integrity
WITH (security_invoker = true)
AS
WITH base AS (
  SELECT cp.id AS package_id, cp.title AS package_title, cp.certification_id,
         cp.curriculum_id, c.title AS certification_title
  FROM public.course_packages cp
  LEFT JOIN public.certifications c ON c.id = cp.certification_id
  WHERE cp.status = 'published' AND cp.is_published = true
),
product_check AS (
  SELECT b.package_id,
    (SELECT COUNT(*) FROM public.products p
       WHERE p.certification_id = b.certification_id AND p.status <> 'archived') AS product_count,
    (SELECT p.id FROM public.products p
       WHERE p.certification_id = b.certification_id AND p.status <> 'archived'
       ORDER BY CASE WHEN p.status='active' THEN 0 ELSE 1 END, p.created_at LIMIT 1) AS product_id
  FROM base b
),
price_check AS (
  SELECT b.package_id,
    (SELECT pp.id FROM public.products p
       JOIN public.product_prices pp ON pp.product_id = p.id
      WHERE p.certification_id = b.certification_id AND p.status <> 'archived' AND pp.active = true
      ORDER BY pp.created_at DESC LIMIT 1) AS active_price_id,
    (SELECT pp.amount_cents FROM public.products p
       JOIN public.product_prices pp ON pp.product_id = p.id
      WHERE p.certification_id = b.certification_id AND p.status <> 'archived' AND pp.active = true
      ORDER BY pp.created_at DESC LIMIT 1) AS active_price_cents
  FROM base b
),
seo_check AS (
  SELECT b.package_id,
    EXISTS (SELECT 1 FROM public.seo_content_pages s
             WHERE s.package_id = b.package_id AND s.status = 'published') AS seo_published,
    EXISTS (SELECT 1 FROM public.seo_content_pages s
             WHERE s.package_id = b.package_id AND s.status = 'draft') AS seo_draft_exists,
    (SELECT COUNT(*) FROM public.seo_content_pages s
       WHERE s.package_id = b.package_id AND s.status = 'draft')::int AS seo_draft_count
  FROM base b
),
-- Funnel-MAPPING (readiness, not traffic):
-- Proxy: a published SEO page is the entry surface that emits package_id-tagged events.
-- TODO: replace with explicit package_funnel_mappings table when introduced.
funnel_mapping_check AS (
  SELECT b.package_id,
    EXISTS (SELECT 1 FROM public.seo_content_pages s
             WHERE s.package_id = b.package_id AND s.status = 'published') AS has_funnel_tracking_mapping
  FROM base b
),
-- Pure observability (info-only, never feeds e2e_status):
funnel_traffic_obs AS (
  SELECT b.package_id,
    (SELECT COUNT(*) FROM public.conversion_events ce
       WHERE ce.created_at > now() - interval '7 days'
         AND COALESCE((ce.metadata->>'smoke_test')::boolean, false) = false
         AND (ce.metadata->>'package_id')::uuid = b.package_id)::int AS events_7d,
    (SELECT COUNT(DISTINCT ce.event_type) FROM public.conversion_events ce
       WHERE ce.created_at > now() - interval '7 days'
         AND COALESCE((ce.metadata->>'smoke_test')::boolean, false) = false
         AND (ce.metadata->>'package_id')::uuid = b.package_id
         AND ce.event_type IN ('lead_magnet_view','quiz_started','quiz_completed','lead_capture_submitted','checkout_complete'))::int AS distinct_strict_events_7d
  FROM base b
),
pricing_classify AS (
  SELECT b.package_id, cls.tier_key, cls.confidence
  FROM base b
  LEFT JOIN LATERAL public.classify_package_pricing_tier(b.package_title) cls(tier_key, price_cents, confidence, reason) ON true
)
SELECT
  b.package_id, b.package_title, b.certification_id, b.certification_title,
  -- Readiness booleans
  (pc.product_count >= 1) AS has_product,
  (pr.active_price_id IS NOT NULL) AS has_active_price,
  sc.seo_published AS has_published_seo_page,
  fm.has_funnel_tracking_mapping,
  -- Domain status
  CASE WHEN pc.product_count = 1 THEN 'green'
       WHEN pc.product_count > 1 THEN 'yellow'
       ELSE 'red' END AS product_status,
  pc.product_count, pc.product_id,
  CASE WHEN pr.active_price_id IS NOT NULL THEN 'green' ELSE 'red' END AS pricing_status,
  pr.active_price_id, pr.active_price_cents,
  CASE WHEN sc.seo_published THEN 'green'
       WHEN sc.seo_draft_exists THEN 'yellow'
       ELSE 'red' END AS seo_status,
  sc.seo_published, sc.seo_draft_count,
  CASE WHEN fm.has_funnel_tracking_mapping THEN 'green' ELSE 'yellow' END AS funnel_mapping_status,
  -- Info-only (NEVER feeds e2e_status):
  fto.events_7d AS funnel_traffic_events_7d,
  fto.distinct_strict_events_7d AS funnel_traffic_distinct_strict_7d,
  pcls.tier_key AS suggested_tier, pcls.confidence AS tier_confidence,
  -- E2E status: red = price missing OR seo missing
  --             yellow = funnel mapping missing OR duplicate product OR seo only draft
  --             green = price + seo + funnel mapping + 1 product
  CASE
    WHEN pr.active_price_id IS NULL OR NOT sc.seo_published THEN 'red'
    WHEN NOT fm.has_funnel_tracking_mapping OR pc.product_count > 1 THEN 'yellow'
    ELSE 'green'
  END AS e2e_status,
  -- Heal flags (Funnel-Mapping is NOT auto-healable here — handled via Code/Mapping-Tabelle)
  jsonb_build_object(
    'seo_publish_drafts',         (NOT sc.seo_published AND sc.seo_draft_exists),
    'pricing_create',             (pr.active_price_id IS NULL AND pc.product_count = 1 AND pcls.confidence = 'high'),
    'manual_pricing',             (pr.active_price_id IS NULL AND (pc.product_count <> 1 OR pcls.confidence IS DISTINCT FROM 'high')),
    'manual_duplicate_product',   (pc.product_count > 1),
    'manual_seo_missing',         (NOT sc.seo_published AND NOT sc.seo_draft_exists),
    'manual_funnel_mapping',      (NOT fm.has_funnel_tracking_mapping)
  ) AS heal_flags,
  -- auto_healable covers ONLY pricing+seo+product-duplicates. NEVER funnel/traffic.
  (
    (pr.active_price_id IS NOT NULL OR (pc.product_count = 1 AND pcls.confidence = 'high'))
    AND (sc.seo_published OR sc.seo_draft_exists)
    AND pc.product_count <= 1
  ) AS auto_healable,
  now() AS checked_at
FROM base b
JOIN product_check pc          ON pc.package_id = b.package_id
JOIN price_check pr            ON pr.package_id = b.package_id
JOIN seo_check sc              ON sc.package_id = b.package_id
JOIN funnel_mapping_check fm   ON fm.package_id = b.package_id
JOIN funnel_traffic_obs fto    ON fto.package_id = b.package_id
LEFT JOIN pricing_classify pcls ON pcls.package_id = b.package_id;

REVOKE ALL ON public.v_package_e2e_integrity FROM PUBLIC;
GRANT SELECT ON public.v_package_e2e_integrity TO authenticated, service_role;

-- Master view (unchanged shape, recomputed e2e aggregates)
CREATE VIEW public.v_platform_integrity
WITH (security_invoker = true)
AS
WITH pricing AS (
  SELECT status AS pricing_status, published_without_price, duplicate_product_cases,
         manual_review_cases, total_published_packages
    FROM public.v_pricing_integrity_check
), funnel AS (
  SELECT status AS funnel_status, tracking_completeness_status, funnel_continuity_status,
         attribution_quality_status, events_total_7d, tracking_completeness_pct
    FROM public.v_funnel_integrity_check
), publish AS (
  SELECT COUNT(*)::int AS published_packages_total,
         COUNT(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM public.seo_content_pages s
            WHERE s.package_id = cp.id AND s.status = 'published'))::int AS published_without_seo_page
    FROM public.course_packages cp
   WHERE cp.status='published' AND cp.is_published = true
), seo AS (
  SELECT pub.published_packages_total, pub.published_without_seo_page,
         CASE WHEN pub.published_without_seo_page = 0 THEN 'green'
              WHEN pub.published_without_seo_page <= 2 THEN 'yellow'
              ELSE 'red' END AS seo_publish_status
    FROM publish pub
), e2e AS (
  SELECT
    COUNT(*)::int AS e2e_total_packages,
    COUNT(*) FILTER (WHERE e2e_status = 'red')::int AS e2e_red_count,
    COUNT(*) FILTER (WHERE e2e_status = 'yellow')::int AS e2e_yellow_count,
    COUNT(*) FILTER (WHERE e2e_status = 'green')::int AS e2e_green_count,
    COUNT(*) FILTER (WHERE e2e_status <> 'green' AND auto_healable)::int AS e2e_auto_healable_count,
    COUNT(*) FILTER (WHERE e2e_status <> 'green' AND NOT auto_healable)::int AS e2e_manual_count,
    CASE
      WHEN COUNT(*) FILTER (WHERE e2e_status='red' AND NOT auto_healable) > 0 THEN 'red'
      WHEN COUNT(*) FILTER (WHERE e2e_status <> 'green') > 0 THEN 'yellow'
      ELSE 'green'
    END AS e2e_pipeline_status
  FROM public.v_package_e2e_integrity
)
SELECT
  p.pricing_status, p.published_without_price, p.total_published_packages,
  f.funnel_status, f.tracking_completeness_status, f.funnel_continuity_status,
  f.attribution_quality_status, f.events_total_7d, f.tracking_completeness_pct,
  s.published_without_seo_page, s.seo_publish_status,
  e.e2e_pipeline_status, e.e2e_total_packages, e.e2e_red_count, e.e2e_yellow_count,
  e.e2e_green_count, e.e2e_auto_healable_count, e.e2e_manual_count,
  CASE
    WHEN 'red' IN (p.pricing_status, f.funnel_status, s.seo_publish_status, e.e2e_pipeline_status) THEN 'red'
    WHEN 'yellow' IN (p.pricing_status, f.funnel_status, s.seo_publish_status, e.e2e_pipeline_status) THEN 'yellow'
    ELSE 'green'
  END AS platform_status,
  now() AS checked_at
FROM pricing p, funnel f, seo s, e2e e;

REVOKE ALL ON public.v_platform_integrity FROM PUBLIC;
GRANT SELECT ON public.v_platform_integrity TO authenticated, service_role;
