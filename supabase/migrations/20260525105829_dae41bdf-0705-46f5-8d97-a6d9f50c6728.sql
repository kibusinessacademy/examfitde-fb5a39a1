-- ============================================================
-- E3e.5 Cornerstone Blog Score v1
-- ============================================================

-- 1) Diagnostic SSOT: per-blog cornerstone score with component breakdown
CREATE OR REPLACE VIEW public.v_cornerstone_blog_score AS
SELECT
  ba.id                          AS blog_article_id,
  ba.slug                        AS blog_slug,
  ba.title                       AS blog_title,
  ba.source_curriculum_id,
  ba.source_package_id,
  ba.word_count,
  ba.is_winner,
  ba.total_views,
  ba.performance_score,
  -- component scores (0..1 each)
  LEAST(1.0, COALESCE(ba.word_count,0)::numeric / 1800.0)                                                AS s_depth,
  LEAST(1.0, jsonb_array_length(COALESCE(ba.faq_json,'[]'::jsonb))::numeric / 6.0)                       AS s_faq,
  CASE WHEN ba.content_quality_signals IS NOT NULL
         AND ba.content_quality_signals <> '{}'::jsonb THEN 1.0 ELSE 0.0 END                             AS s_quality,
  CASE WHEN ba.hero_image_url IS NOT NULL THEN 1.0 ELSE 0.0 END                                          AS s_hero,
  CASE WHEN ba.competency_id  IS NOT NULL THEN 1.0 ELSE 0.0 END                                          AS s_anchor,
  CASE WHEN ba.is_winner THEN 1.0 ELSE 0.0 END                                                           AS s_winner,
  LEAST(1.0, COALESCE(ba.total_views,0)::numeric / 500.0)                                                AS s_views,
  LEAST(1.0, COALESCE(ba.performance_score,0)::numeric)                                                  AS s_perf,
  -- composite cornerstone score (weighted, capped 0..1)
  LEAST(1.00, GREATEST(0.00,
      0.25 * LEAST(1.0, COALESCE(ba.word_count,0)::numeric / 1800.0)
    + 0.15 * LEAST(1.0, jsonb_array_length(COALESCE(ba.faq_json,'[]'::jsonb))::numeric / 6.0)
    + 0.10 * (CASE WHEN ba.content_quality_signals IS NOT NULL AND ba.content_quality_signals <> '{}'::jsonb THEN 1 ELSE 0 END)
    + 0.10 * (CASE WHEN ba.hero_image_url IS NOT NULL THEN 1 ELSE 0 END)
    + 0.10 * (CASE WHEN ba.competency_id IS NOT NULL THEN 1 ELSE 0 END)
    + 0.10 * (CASE WHEN ba.is_winner THEN 1 ELSE 0 END)
    + 0.10 * LEAST(1.0, COALESCE(ba.total_views,0)::numeric / 500.0)
    + 0.10 * LEAST(1.0, COALESCE(ba.performance_score,0)::numeric)
  ))::numeric(5,4) AS cornerstone_score
FROM public.blog_articles ba
WHERE ba.status = 'published';

REVOKE ALL ON public.v_cornerstone_blog_score FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_cornerstone_blog_score TO service_role;

-- 2) Replace v_seo_bridge_candidates_v1 — only ptcb arm changes
CREATE OR REPLACE VIEW public.v_seo_bridge_candidates_v1 AS
 WITH gov AS (
         SELECT seo_bridge_governance.link_type,
            seo_bridge_governance.max_outbound_per_source,
            seo_bridge_governance.min_semantic_similarity
           FROM seo_bridge_governance
        ), btp AS (
         SELECT 'blog_to_pillar'::text AS link_type,
            ba.id::text AS source_id,
            'contextual_blog'::text AS source_layer,
            '/blog/'::text || ba.slug AS source_url,
            ba.title AS source_title,
            ba.status = 'published'::text AS source_published,
            csp.id::text AS target_id,
            'pillar_authority'::text AS target_layer,
            '/'::text || csp.slug AS target_url,
            csp.title AS target_title,
            csp.is_published AS target_published,
                CASE
                    WHEN ba.source_package_id IS NOT NULL THEN 1.00
                    WHEN ba.source_curriculum_id IS NOT NULL THEN 0.85
                    ELSE 0.60
                END AS similarity_score
           FROM blog_articles ba
             JOIN course_packages cp ON cp.curriculum_id = ba.source_curriculum_id AND cp.status = 'published'::text
             JOIN certification_catalog cc ON cc.linked_certification_id = cp.certification_id
             JOIN certification_seo_pages csp ON csp.certification_catalog_id = cc.id AND csp.is_published
          WHERE ba.status = 'published'::text
        ), ptcb AS (
         -- E3e.5: cornerstone score replaces naive word_count proxy
         SELECT 'pillar_to_cornerstone_blog'::text AS link_type,
            csp.id::text AS source_id,
            'pillar_authority'::text AS source_layer,
            '/'::text || csp.slug AS source_url,
            csp.title AS source_title,
            csp.is_published AS source_published,
            ba.id::text AS target_id,
            'contextual_blog'::text AS target_layer,
            '/blog/'::text || ba.slug AS target_url,
            ba.title AS target_title,
            ba.status = 'published'::text AS target_published,
            LEAST(1.00, GREATEST(0.00,
                0.25 * LEAST(1.0, COALESCE(ba.word_count,0)::numeric / 1800.0)
              + 0.15 * LEAST(1.0, jsonb_array_length(COALESCE(ba.faq_json,'[]'::jsonb))::numeric / 6.0)
              + 0.10 * (CASE WHEN ba.content_quality_signals IS NOT NULL AND ba.content_quality_signals <> '{}'::jsonb THEN 1 ELSE 0 END)
              + 0.10 * (CASE WHEN ba.hero_image_url IS NOT NULL THEN 1 ELSE 0 END)
              + 0.10 * (CASE WHEN ba.competency_id IS NOT NULL THEN 1 ELSE 0 END)
              + 0.10 * (CASE WHEN ba.is_winner THEN 1 ELSE 0 END)
              + 0.10 * LEAST(1.0, COALESCE(ba.total_views,0)::numeric / 500.0)
              + 0.10 * LEAST(1.0, COALESCE(ba.performance_score,0)::numeric)
            ))::numeric(5,4) AS similarity_score
           FROM certification_seo_pages csp
             JOIN certification_catalog cc ON cc.id = csp.certification_catalog_id
             JOIN course_packages cp ON cp.certification_id = cc.linked_certification_id AND cp.status = 'published'::text
             JOIN blog_articles ba ON ba.source_curriculum_id = cp.curriculum_id AND ba.status = 'published'::text
          WHERE csp.is_published
        ), btep AS (
         SELECT 'blog_to_exam_package'::text AS link_type,
            ba.id::text AS source_id,
            'contextual_blog'::text AS source_layer,
            '/blog/'::text || ba.slug AS source_url,
            ba.title AS source_title,
            ba.status = 'published'::text AS source_published,
            cp.id::text AS target_id,
            'exam_package'::text AS target_layer,
            '/shop/'::text || COALESCE(p.slug, cp.id::text) AS target_url,
            cp.title AS target_title,
            cp.status = 'published'::text AS target_published,
                CASE
                    WHEN ba.source_package_id = cp.id THEN 1.00
                    WHEN ba.source_curriculum_id IS NOT NULL AND cp.curriculum_id = ba.source_curriculum_id THEN 0.75
                    ELSE 0.50
                END AS similarity_score
           FROM blog_articles ba
             JOIN course_packages cp ON (cp.id = ba.source_package_id OR cp.curriculum_id = ba.source_curriculum_id) AND cp.status = 'published'::text
             LEFT JOIN products p ON p.id = cp.product_id
          WHERE ba.status = 'published'::text
        ), ctb AS (
         SELECT 'cluster_to_blog'::text AS link_type, NULL::text, 'cluster_intent'::text, NULL::text, NULL::text, false,
                NULL::text, 'contextual_blog'::text, NULL::text, NULL::text, false, 0.00 WHERE false
        ), ctlc AS (
         SELECT 'certification_to_learning_content'::text AS link_type, NULL::text, 'certification'::text, NULL::text, NULL::text, false,
                NULL::text, 'learning_content'::text, NULL::text, NULL::text, false, 0.00 WHERE false
        ), all_cands AS (
         SELECT * FROM btp
         UNION ALL SELECT * FROM ptcb
         UNION ALL SELECT * FROM btep
         UNION ALL SELECT * FROM ctb
         UNION ALL SELECT * FROM ctlc
        ), ranked AS (
         SELECT ac.*,
            row_number() OVER (PARTITION BY ac.link_type, ac.source_id ORDER BY ac.similarity_score DESC, ac.target_id) AS source_rank
           FROM all_cands ac
        ), dedupe AS (
         SELECT r.*,
            (EXISTS (SELECT 1 FROM seo_internal_link_suggestions sils
                      WHERE sils.source_url = r.source_url AND sils.target_url = r.target_url
                        AND sils.link_type = r.link_type
                        AND sils.status = ANY (ARRAY['active','suggested','approved']))) AS duplicate_existing,
            g.max_outbound_per_source,
            g.min_semantic_similarity
           FROM ranked r
             LEFT JOIN gov g ON g.link_type = r.link_type
        )
 SELECT link_type, source_id, source_layer, source_url, source_title, source_published,
        target_id, target_layer, target_url, target_title, target_published,
        similarity_score, source_rank, duplicate_existing,
        max_outbound_per_source, min_semantic_similarity,
        CASE
            WHEN source_id IS NULL THEN 'NO_SOURCE_LAYER_DATA'
            WHEN target_id IS NULL THEN 'NO_TARGET_LAYER_DATA'
            WHEN NOT source_published OR NOT target_published THEN 'BLOCKED_UNPUBLISHED'
            WHEN duplicate_existing THEN 'BLOCKED_DUPLICATE_EXISTING'
            WHEN similarity_score < COALESCE(min_semantic_similarity, 0.50) THEN 'BLOCKED_BELOW_MIN_SIMILARITY'
            WHEN source_rank > COALESCE(max_outbound_per_source, 3) THEN 'BLOCKED_SOURCE_CAP'
            ELSE 'READY'
        END AS decision
   FROM dedupe;

-- 3) Admin RPC: cornerstone score summary
CREATE OR REPLACE FUNCTION public.admin_get_cornerstone_blog_score_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_is_service boolean := (auth.jwt() ->> 'role') = 'service_role';
  v_result jsonb;
BEGIN
  IF NOT (v_is_admin OR v_is_service) THEN RAISE EXCEPTION 'permission denied'; END IF;

  SELECT jsonb_build_object(
    'total_published_blogs',  (SELECT count(*)::int FROM public.v_cornerstone_blog_score),
    'avg_cornerstone_score',  (SELECT round(avg(cornerstone_score),3) FROM public.v_cornerstone_blog_score),
    'p75_cornerstone_score',  (SELECT round((percentile_cont(0.75) WITHIN GROUP (ORDER BY cornerstone_score))::numeric,3) FROM public.v_cornerstone_blog_score),
    'p90_cornerstone_score',  (SELECT round((percentile_cont(0.90) WITHIN GROUP (ORDER BY cornerstone_score))::numeric,3) FROM public.v_cornerstone_blog_score),
    'eligible_above_min_06',  (SELECT count(*)::int FROM public.v_cornerstone_blog_score WHERE cornerstone_score >= 0.60),
    'eligible_above_07',      (SELECT count(*)::int FROM public.v_cornerstone_blog_score WHERE cornerstone_score >= 0.70),
    'ptcb_ready',             (SELECT count(*)::int FROM public.v_seo_bridge_candidates_v1 WHERE link_type='pillar_to_cornerstone_blog' AND decision='READY'),
    'ptcb_blocked_min_sim',   (SELECT count(*)::int FROM public.v_seo_bridge_candidates_v1 WHERE link_type='pillar_to_cornerstone_blog' AND decision='BLOCKED_BELOW_MIN_SIMILARITY'),
    'ptcb_blocked_dup',       (SELECT count(*)::int FROM public.v_seo_bridge_candidates_v1 WHERE link_type='pillar_to_cornerstone_blog' AND decision='BLOCKED_DUPLICATE_EXISTING'),
    'ptcb_distinct_sources',  (SELECT count(DISTINCT source_id)::int FROM public.v_seo_bridge_candidates_v1 WHERE link_type='pillar_to_cornerstone_blog' AND decision='READY'),
    'ptcb_distinct_targets',  (SELECT count(DISTINCT target_id)::int FROM public.v_seo_bridge_candidates_v1 WHERE link_type='pillar_to_cornerstone_blog' AND decision='READY'),
    'pilot_active',           (SELECT pilot_active FROM public.seo_bridge_type_registry WHERE link_type='pillar_to_cornerstone_blog'),
    'snapshot_at',            now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_cornerstone_blog_score_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_cornerstone_blog_score_summary() TO authenticated, service_role;

-- 4) Update pilot_notes (registry stays pilot_active=false — Human-Gate)
UPDATE public.seo_bridge_type_registry
   SET pilot_notes = 'E3e.5 cornerstone score deployed 2026-05-25; awaits manual pilot activation after readiness review',
       notes       = 'Pillar pages link to canonical cornerstone blog explainer — score = depth+faq+quality+anchor+winner+views+perf'
 WHERE link_type = 'pillar_to_cornerstone_blog';

UPDATE public.seo_bridge_governance
   SET notes = 'Reverse direction; only canonical cornerstones | E3e.5 cornerstone score live; pilot still deactivated awaiting readiness review',
       updated_at = now()
 WHERE link_type = 'pillar_to_cornerstone_blog';

-- 5) Audit contract
INSERT INTO public.ops_audit_contract(action_type, required_keys, schema_version, owner_module)
VALUES (
  'cornerstone_blog_score_v1_deployed',
  ARRAY['version','formula_weights','ptcb_ready_before','ptcb_ready_after','avg_cornerstone_score'],
  1, 'seo.bridges'
)
ON CONFLICT (action_type) DO UPDATE SET required_keys=EXCLUDED.required_keys, schema_version=EXCLUDED.schema_version, updated_at=now();

-- 6) Audit emit
SELECT public.fn_emit_audit(
  'cornerstone_blog_score_v1_deployed',
  'system',
  'v_seo_bridge_candidates_v1.ptcb',
  'success',
  jsonb_build_object(
    'version','v1',
    'formula_weights', jsonb_build_object(
       'depth',0.25,'faq',0.15,'quality',0.10,'hero',0.10,
       'anchor',0.10,'winner',0.10,'views',0.10,'perf',0.10),
    'ptcb_ready_before', 2,
    'ptcb_ready_after',  (SELECT count(*)::int FROM public.v_seo_bridge_candidates_v1 WHERE link_type='pillar_to_cornerstone_blog' AND decision='READY'),
    'avg_cornerstone_score', (SELECT round(avg(cornerstone_score),3) FROM public.v_cornerstone_blog_score),
    'pilot_active', false,
    'gate', 'human_approval_required'
  ),
  'migration', NULL
);