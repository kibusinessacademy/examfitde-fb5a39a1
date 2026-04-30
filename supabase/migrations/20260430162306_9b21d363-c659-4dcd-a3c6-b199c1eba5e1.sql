
DROP VIEW IF EXISTS public.v_platform_integrity;
DROP VIEW IF EXISTS public.v_package_e2e_integrity;

-- 1) Per-Paket E2E-View
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
funnel_check AS (
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
  CASE WHEN fc.distinct_strict_events_7d >= 3 THEN 'green'
       WHEN fc.events_7d > 0 THEN 'yellow'
       ELSE 'red' END AS funnel_status,
  fc.events_7d AS funnel_events_7d, fc.distinct_strict_events_7d,
  pcls.tier_key AS suggested_tier, pcls.confidence AS tier_confidence,
  CASE
    WHEN pc.product_count = 0 OR pr.active_price_id IS NULL OR NOT sc.seo_published OR fc.events_7d = 0 THEN 'red'
    WHEN pc.product_count > 1 OR (sc.seo_draft_exists AND NOT sc.seo_published) OR fc.distinct_strict_events_7d < 3 THEN 'yellow'
    ELSE 'green'
  END AS e2e_status,
  jsonb_build_object(
    'seo_publish_drafts', (NOT sc.seo_published AND sc.seo_draft_exists),
    'pricing_create',     (pr.active_price_id IS NULL AND pc.product_count = 1 AND pcls.confidence = 'high'),
    'manual_pricing',     (pr.active_price_id IS NULL AND (pc.product_count <> 1 OR pcls.confidence IS DISTINCT FROM 'high')),
    'manual_duplicate_product', (pc.product_count > 1),
    'manual_seo_missing', (NOT sc.seo_published AND NOT sc.seo_draft_exists),
    'manual_funnel_mapping', (fc.events_7d = 0)
  ) AS heal_flags,
  (
    (pc.product_count = 1 OR pc.product_count IS NULL) AND
    (pr.active_price_id IS NOT NULL OR (pc.product_count = 1 AND pcls.confidence = 'high')) AND
    (sc.seo_published OR sc.seo_draft_exists) AND
    fc.events_7d > 0
  ) AS auto_healable,
  now() AS checked_at
FROM base b
JOIN product_check pc ON pc.package_id = b.package_id
JOIN price_check pr ON pr.package_id = b.package_id
JOIN seo_check sc ON sc.package_id = b.package_id
JOIN funnel_check fc ON fc.package_id = b.package_id
LEFT JOIN pricing_classify pcls ON pcls.package_id = b.package_id;

REVOKE ALL ON public.v_package_e2e_integrity FROM PUBLIC;
GRANT SELECT ON public.v_package_e2e_integrity TO authenticated, service_role;

-- 2) Master-View neu
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

-- 3) Guard-Funktion
CREATE OR REPLACE FUNCTION public.fn_e2e_integrity_guard(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seo_healed int := 0;
  v_pricing_safe int := 0;
  v_alerts_created int := 0;
  v_total_red int := 0;
  v_total_yellow int := 0;
  v_started timestamptz := clock_timestamp();
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM public.v_package_e2e_integrity WHERE e2e_status <> 'green'
  LOOP
    IF rec.e2e_status = 'red' THEN v_total_red := v_total_red + 1;
    ELSE v_total_yellow := v_total_yellow + 1; END IF;

    IF (rec.heal_flags->>'seo_publish_drafts')::boolean THEN
      IF NOT p_dry_run THEN
        UPDATE public.seo_content_pages
           SET status = 'published', updated_at = now()
         WHERE package_id = rec.package_id AND status = 'draft';
      END IF;
      v_seo_healed := v_seo_healed + 1;
      INSERT INTO public.auto_heal_log (trigger_source, action_type, target_type, target_id, result_status, result_detail, input_params, metadata)
      VALUES ('e2e_integrity_guard',
              CASE WHEN p_dry_run THEN 'e2e_seo_publish_drafts_dryrun' ELSE 'e2e_seo_publish_drafts' END,
              'course_package', rec.package_id::text, 'success',
              format('Published %s SEO draft(s) for %s', rec.seo_draft_count, rec.package_title),
              jsonb_build_object('dry_run', p_dry_run, 'draft_count', rec.seo_draft_count),
              jsonb_build_object('certification_id', rec.certification_id, 'e2e_status', rec.e2e_status));
    END IF;

    IF (rec.heal_flags->>'pricing_create')::boolean THEN
      v_pricing_safe := v_pricing_safe + 1;
      INSERT INTO public.auto_heal_log (trigger_source, action_type, target_type, target_id, result_status, result_detail, input_params, metadata)
      VALUES ('e2e_integrity_guard', 'e2e_pricing_safe_to_apply', 'course_package', rec.package_id::text,
              'pending_admin',
              format('Eindeutige Tier-Klassifikation (%s, hoch) — bereit für admin pricing-backfill', rec.suggested_tier),
              jsonb_build_object('dry_run', p_dry_run, 'suggested_tier', rec.suggested_tier),
              jsonb_build_object('certification_id', rec.certification_id));
    END IF;

    IF (rec.heal_flags->>'manual_pricing')::boolean
       OR (rec.heal_flags->>'manual_duplicate_product')::boolean
       OR (rec.heal_flags->>'manual_seo_missing')::boolean
       OR (rec.heal_flags->>'manual_funnel_mapping')::boolean
    THEN
      IF NOT p_dry_run THEN
        INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
        VALUES (
          format('E2E-Drift: %s', rec.package_title),
          format('Pipeline-Status %s. Manuell: %s%s%s%s',
            rec.e2e_status,
            CASE WHEN (rec.heal_flags->>'manual_pricing')::boolean THEN '[Pricing mehrdeutig] ' ELSE '' END,
            CASE WHEN (rec.heal_flags->>'manual_duplicate_product')::boolean THEN '[Doppelte Produkte] ' ELSE '' END,
            CASE WHEN (rec.heal_flags->>'manual_seo_missing')::boolean THEN '[SEO-Seite fehlt komplett] ' ELSE '' END,
            CASE WHEN (rec.heal_flags->>'manual_funnel_mapping')::boolean THEN '[Funnel-Mapping fehlt] ' ELSE '' END
          ),
          'e2e_integrity', rec.e2e_status,
          'course_package', rec.package_id,
          jsonb_build_object(
            'heal_flags', rec.heal_flags, 'product_count', rec.product_count,
            'pricing_status', rec.pricing_status, 'seo_status', rec.seo_status,
            'funnel_status', rec.funnel_status, 'suggested_tier', rec.suggested_tier,
            'tier_confidence', rec.tier_confidence, 'guard_run_at', now()
          )
        );
      END IF;
      v_alerts_created := v_alerts_created + 1;
    END IF;
  END LOOP;

  INSERT INTO public.auto_heal_log (trigger_source, action_type, target_type, target_id, result_status, result_detail, input_params, metadata, duration_ms)
  VALUES ('e2e_integrity_guard', 'e2e_guard_run_summary', 'platform', 'global', 'success',
          format('seo_healed=%s pricing_safe=%s alerts=%s red=%s yellow=%s', v_seo_healed, v_pricing_safe, v_alerts_created, v_total_red, v_total_yellow),
          jsonb_build_object('dry_run', p_dry_run),
          jsonb_build_object('seo_healed', v_seo_healed, 'pricing_safe', v_pricing_safe,
                             'alerts_created', v_alerts_created, 'red', v_total_red, 'yellow', v_total_yellow),
          (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int);

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'seo_drafts_published', v_seo_healed,
    'pricing_safe_to_apply', v_pricing_safe,
    'admin_alerts_created', v_alerts_created,
    'total_red', v_total_red, 'total_yellow', v_total_yellow,
    'duration_ms', (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int,
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_e2e_integrity_guard(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_e2e_integrity_guard(boolean) TO service_role;
