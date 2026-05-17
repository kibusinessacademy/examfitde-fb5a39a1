
CREATE OR REPLACE VIEW public.v_package_seo_readiness_v1 AS
WITH pkgs AS (
  SELECT
    cp.id AS package_id, cp.title AS package_title, cp.track::text AS track,
    cp.curriculum_id, cp.status AS pkg_status, cp.product_id
  FROM public.course_packages cp WHERE cp.status = 'published'
),
policy AS (
  SELECT p.package_id,
    CASE UPPER(COALESCE(p.track,''))
      WHEN 'AUSBILDUNG_VOLL' THEN 'full' WHEN 'EXAM_FIRST_PLUS' THEN 'cert'
      WHEN 'STUDIUM' THEN 'academic' ELSE 'exam_first' END AS seo_track_policy,
    CASE UPPER(COALESCE(p.track,''))
      WHEN 'AUSBILDUNG_VOLL' THEN 1 WHEN 'EXAM_FIRST_PLUS' THEN 1
      WHEN 'STUDIUM' THEN 1 ELSE 0 END AS seo_min_pillars_required,
    CASE UPPER(COALESCE(p.track,''))
      WHEN 'AUSBILDUNG_VOLL' THEN 8 WHEN 'EXAM_FIRST_PLUS' THEN 5
      WHEN 'STUDIUM' THEN 5 ELSE 3 END AS seo_min_spokes_required,
    CASE UPPER(COALESCE(p.track,''))
      WHEN 'AUSBILDUNG_VOLL' THEN 5 WHEN 'EXAM_FIRST_PLUS' THEN 3
      WHEN 'STUDIUM' THEN 3 ELSE 1 END AS seo_min_blogs_required,
    CASE UPPER(COALESCE(p.track,''))
      WHEN 'AUSBILDUNG_VOLL' THEN 6 WHEN 'EXAM_FIRST_PLUS' THEN 4
      WHEN 'STUDIUM' THEN 4 ELSE 2 END AS seo_min_internal_links_required
  FROM pkgs p
),
pillars AS (
  SELECT v.package_id,
    COUNT(*) FILTER (WHERE v.seo_is_published) AS pillar_published_count,
    COUNT(*) FILTER (WHERE v.mapping_source = 'unmatched') AS orphaned_pillar_count
  FROM public.v_certification_seo_with_product v
  WHERE v.package_id IS NOT NULL GROUP BY v.package_id
),
spokes AS (
  SELECT p.package_id,
    COUNT(*) FILTER (WHERE s.status = 'published') AS spoke_published_count,
    COUNT(*) FILTER (WHERE s.status IN ('draft','queued','generating')) AS spoke_pending_count
  FROM pkgs p LEFT JOIN public.seo_content_pages s
    ON s.package_id = p.package_id
    OR (s.package_id IS NULL AND s.curriculum_id = p.curriculum_id)
  GROUP BY p.package_id
),
blogs AS (
  SELECT p.package_id,
    COUNT(*) FILTER (WHERE b.status = 'published') AS blog_published_count,
    COUNT(*) FILTER (WHERE b.status IN ('draft','review','queued')) AS blog_pending_count
  FROM pkgs p LEFT JOIN public.blog_articles b
    ON b.source_package_id = p.package_id
    OR (b.source_package_id IS NULL AND b.source_curriculum_id = p.curriculum_id)
  GROUP BY p.package_id
),
intents AS (
  SELECT p.package_id,
    COUNT(*) AS intent_count,
    COUNT(*) FILTER (WHERE q.generation_status = 'queued') AS intent_queued_count,
    COUNT(*) FILTER (WHERE q.generation_status IN ('generated','published','complete')) AS intent_generated_count,
    COUNT(*) FILTER (WHERE q.generation_status = 'queued'
                     AND q.last_enqueued_at < (now() - INTERVAL '24 hours')) AS intent_stale_count,
    COUNT(*) FILTER (WHERE q.thin_content_risk IS NOT NULL
                     AND q.thin_content_risk NOT IN ('','none','low')) AS intent_thin_content_count
  FROM pkgs p LEFT JOIN public.seo_content_priority_queue q
    ON q.curriculum_id = p.curriculum_id
  GROUP BY p.package_id
),
prod AS (
  SELECT p.package_id, pr.slug AS product_slug
  FROM pkgs p LEFT JOIN public.products pr ON pr.id = p.product_id
),
links AS (
  SELECT pr.package_id,
    COUNT(*) FILTER (WHERE l.status = 'active') AS internal_link_active_count,
    COUNT(*) FILTER (WHERE l.status = 'suggested') AS internal_link_suggested_count
  FROM prod pr LEFT JOIN public.seo_internal_link_suggestions l
    ON pr.product_slug IS NOT NULL AND l.target_url ILIKE '%' || pr.product_slug || '%'
  GROUP BY pr.package_id
)
SELECT
  p.package_id, p.package_title, p.track, p.curriculum_id,
  pol.seo_track_policy, pol.seo_min_pillars_required, pol.seo_min_spokes_required,
  pol.seo_min_blogs_required, pol.seo_min_internal_links_required,
  COALESCE(pi.pillar_published_count, 0) AS pillar_count,
  COALESCE(pi.orphaned_pillar_count, 0)  AS orphaned_pillar_count,
  COALESCE(sp.spoke_published_count, 0)  AS spoke_count,
  COALESCE(sp.spoke_pending_count, 0)    AS spoke_pending_count,
  COALESCE(bl.blog_published_count, 0)   AS blog_count,
  COALESCE(bl.blog_pending_count, 0)     AS blog_pending_count,
  COALESCE(it.intent_count, 0)           AS intent_count,
  COALESCE(it.intent_queued_count, 0)    AS intent_queued_count,
  COALESCE(it.intent_generated_count, 0) AS intent_generated_count,
  COALESCE(it.intent_stale_count, 0)     AS intent_stale_count,
  COALESCE(it.intent_thin_content_count, 0) AS thin_content_risk_count,
  COALESCE(lk.internal_link_active_count, 0)    AS internal_link_active_count,
  COALESCE(lk.internal_link_suggested_count, 0) AS internal_link_suggested_count,
  (COALESCE(pi.pillar_published_count, 0) >= pol.seo_min_pillars_required) AS pillar_ready,
  (COALESCE(sp.spoke_published_count, 0)  >= pol.seo_min_spokes_required)  AS spoke_ready,
  (COALESCE(bl.blog_published_count, 0)   >= pol.seo_min_blogs_required)   AS blog_ready,
  (COALESCE(lk.internal_link_active_count, 0) >= pol.seo_min_internal_links_required) AS internal_link_ready,
  (COALESCE(it.intent_stale_count, 0) = 0) AS intent_pipeline_healthy,
  (
    (COALESCE(pi.pillar_published_count, 0) >= pol.seo_min_pillars_required)
    AND (COALESCE(sp.spoke_published_count, 0) >= pol.seo_min_spokes_required)
    AND (COALESCE(bl.blog_published_count, 0)  >= pol.seo_min_blogs_required)
    AND (COALESCE(lk.internal_link_active_count, 0) >= pol.seo_min_internal_links_required)
    AND (COALESCE(pi.orphaned_pillar_count, 0) = 0)
    AND (COALESCE(it.intent_stale_count, 0) = 0)
  ) AS seo_customer_safe,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN COALESCE(pi.pillar_published_count, 0) < pol.seo_min_pillars_required THEN 'NO_PILLAR_MAPPING' END,
    CASE WHEN COALESCE(pi.orphaned_pillar_count, 0) > 0 THEN 'PILLAR_MAPPING_DRIFT' END,
    CASE WHEN COALESCE(sp.spoke_published_count, 0) < pol.seo_min_spokes_required THEN 'INSUFFICIENT_SPOKE_DEPTH' END,
    CASE WHEN COALESCE(bl.blog_published_count, 0) < pol.seo_min_blogs_required THEN 'BLOG_COVERAGE_LOW' END,
    CASE WHEN COALESCE(lk.internal_link_active_count, 0) < pol.seo_min_internal_links_required
              AND COALESCE(lk.internal_link_suggested_count, 0) > 0 THEN 'INTERNAL_LINK_GRAPH_NOT_MATERIALIZED' END,
    CASE WHEN COALESCE(lk.internal_link_active_count, 0) < pol.seo_min_internal_links_required
              AND COALESCE(lk.internal_link_suggested_count, 0) = 0 THEN 'INTERNAL_LINK_SUGGESTIONS_MISSING' END,
    CASE WHEN COALESCE(it.intent_count, 0) = 0 THEN 'INTENT_COVERAGE_MISSING' END,
    CASE WHEN COALESCE(it.intent_stale_count, 0) > 0 THEN 'INTENT_QUEUE_STALLED' END,
    CASE WHEN COALESCE(it.intent_thin_content_count, 0) > 0 THEN 'THIN_CONTENT_RISK' END
  ], NULL) AS reasons,
  jsonb_build_object(
    'pillar', jsonb_build_object('count', COALESCE(pi.pillar_published_count, 0),
      'required', pol.seo_min_pillars_required, 'orphaned', COALESCE(pi.orphaned_pillar_count, 0)),
    'spoke', jsonb_build_object('count', COALESCE(sp.spoke_published_count, 0),
      'required', pol.seo_min_spokes_required, 'pending', COALESCE(sp.spoke_pending_count, 0)),
    'blog', jsonb_build_object('count', COALESCE(bl.blog_published_count, 0),
      'required', pol.seo_min_blogs_required, 'pending', COALESCE(bl.blog_pending_count, 0)),
    'internal_links', jsonb_build_object('active', COALESCE(lk.internal_link_active_count, 0),
      'suggested', COALESCE(lk.internal_link_suggested_count, 0), 'required', pol.seo_min_internal_links_required),
    'intent', jsonb_build_object('total', COALESCE(it.intent_count, 0),
      'queued', COALESCE(it.intent_queued_count, 0), 'generated', COALESCE(it.intent_generated_count, 0),
      'stale', COALESCE(it.intent_stale_count, 0), 'thin_content', COALESCE(it.intent_thin_content_count, 0))
  ) AS sub_flags
FROM pkgs p
JOIN policy pol ON pol.package_id = p.package_id
LEFT JOIN pillars pi ON pi.package_id = p.package_id
LEFT JOIN spokes  sp ON sp.package_id = p.package_id
LEFT JOIN blogs   bl ON bl.package_id = p.package_id
LEFT JOIN intents it ON it.package_id = p.package_id
LEFT JOIN links   lk ON lk.package_id = p.package_id;

REVOKE ALL ON public.v_package_seo_readiness_v1 FROM PUBLIC;
REVOKE ALL ON public.v_package_seo_readiness_v1 FROM anon;
REVOKE ALL ON public.v_package_seo_readiness_v1 FROM authenticated;
GRANT  SELECT ON public.v_package_seo_readiness_v1 TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_seo_readiness_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_summary jsonb; v_per_track jsonb; v_top_reasons jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'published_total', COUNT(*),
    'seo_customer_safe_count', COUNT(*) FILTER (WHERE seo_customer_safe),
    'seo_customer_safe_pct', ROUND(100.0 * COUNT(*) FILTER (WHERE seo_customer_safe) / NULLIF(COUNT(*), 0), 1),
    'pillar_ready_count', COUNT(*) FILTER (WHERE pillar_ready),
    'spoke_ready_count', COUNT(*) FILTER (WHERE spoke_ready),
    'blog_ready_count', COUNT(*) FILTER (WHERE blog_ready),
    'internal_link_ready_count', COUNT(*) FILTER (WHERE internal_link_ready),
    'intent_pipeline_healthy_count', COUNT(*) FILTER (WHERE intent_pipeline_healthy),
    'orphaned_pillar_total', COALESCE(SUM(orphaned_pillar_count), 0),
    'intent_stale_total', COALESCE(SUM(intent_stale_count), 0),
    'thin_content_risk_total', COALESCE(SUM(thin_content_risk_count), 0),
    'internal_link_active_total', COALESCE(SUM(internal_link_active_count), 0),
    'internal_link_suggested_total', COALESCE(SUM(internal_link_suggested_count), 0)
  ) INTO v_summary FROM public.v_package_seo_readiness_v1;

  SELECT jsonb_agg(jsonb_build_object('track', t.seo_track_policy, 'total', t.total,
    'safe', t.safe, 'safe_pct', ROUND(100.0 * t.safe / NULLIF(t.total, 0), 1))
    ORDER BY t.seo_track_policy) INTO v_per_track
  FROM (SELECT seo_track_policy, COUNT(*) AS total,
        COUNT(*) FILTER (WHERE seo_customer_safe) AS safe
        FROM public.v_package_seo_readiness_v1 GROUP BY seo_track_policy) t;

  SELECT jsonb_agg(jsonb_build_object('reason', r.reason, 'count', r.cnt) ORDER BY r.cnt DESC)
  INTO v_top_reasons
  FROM (SELECT reason, COUNT(*) AS cnt
        FROM public.v_package_seo_readiness_v1, unnest(reasons) AS reason
        GROUP BY reason ORDER BY cnt DESC LIMIT 10) r;

  RETURN jsonb_build_object('summary', v_summary,
    'per_track', COALESCE(v_per_track, '[]'::jsonb),
    'top_reasons', COALESCE(v_top_reasons, '[]'::jsonb),
    'generated_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_seo_readiness_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_seo_readiness_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_readiness_summary() TO authenticated;

DO $$ BEGIN
  PERFORM public.fn_emit_audit('seo_readiness_ssot_e3a_created',
    jsonb_build_object('view','v_package_seo_readiness_v1',
      'rpc','admin_get_seo_readiness_summary','phase','E3a',
      'note','SEO operational truth layer — read-only SSOT, no heal logic'));
EXCEPTION WHEN OTHERS THEN NULL; END$$;
