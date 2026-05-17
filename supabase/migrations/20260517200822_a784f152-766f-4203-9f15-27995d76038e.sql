-- E3e.1 · Bridge-Candidate-Recon (read-only)
-- One concern: unified candidate view + summary + 2 admin RPCs + 1 audit contract.

-- ─────────────────────────────────────────────────────────────
-- Audit contract first
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.ops_audit_contract (action_type, required_keys, schema_version, owner_module) VALUES
  ('bridge_candidate_recon_detected',
   ARRAY['phase','candidates_total','eligible_total','blocked_total','by_link_type'],
   1, 'seo_bridge_layer')
ON CONFLICT (action_type) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 1) Unified candidate view (read-only)
-- ─────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_seo_bridge_candidates_v1 CASCADE;

CREATE VIEW public.v_seo_bridge_candidates_v1 AS
WITH gov AS (
  SELECT link_type,
         max_outbound_per_source,
         min_semantic_similarity
    FROM public.seo_bridge_governance
),
-- ===== blog_to_pillar =====
-- blog → certification_seo_page via curriculum→certification→catalog
btp AS (
  SELECT
    'blog_to_pillar'::text                AS link_type,
    ba.id::text                           AS source_id,
    'contextual_blog'::text               AS source_layer,
    ('/blog/' || ba.slug)                 AS source_url,
    ba.title                              AS source_title,
    (ba.status='published')               AS source_published,
    csp.id::text                          AS target_id,
    'pillar_authority'::text              AS target_layer,
    ('/' || csp.slug)                     AS target_url,
    csp.title                             AS target_title,
    csp.is_published                      AS target_published,
    -- direct cert-catalog match scores highest
    CASE
      WHEN ba.source_package_id IS NOT NULL THEN 1.00
      WHEN ba.source_curriculum_id IS NOT NULL THEN 0.85
      ELSE 0.60
    END::numeric                          AS similarity_score
  FROM public.blog_articles ba
  JOIN public.course_packages cp
    ON cp.curriculum_id = ba.source_curriculum_id
   AND cp.status = 'published'
  JOIN public.certification_catalog cc
    ON cc.linked_certification_id = cp.certification_id
  JOIN public.certification_seo_pages csp
    ON csp.certification_catalog_id = cc.id
   AND csp.is_published
  WHERE ba.status = 'published'
),
-- ===== pillar_to_cornerstone_blog =====
-- pillar → cornerstone blog (highest word_count per pillar within same cert)
ptcb AS (
  SELECT
    'pillar_to_cornerstone_blog'::text    AS link_type,
    csp.id::text                          AS source_id,
    'pillar_authority'::text              AS source_layer,
    ('/' || csp.slug)                     AS source_url,
    csp.title                             AS source_title,
    csp.is_published                      AS source_published,
    ba.id::text                           AS target_id,
    'contextual_blog'::text               AS target_layer,
    ('/blog/' || ba.slug)                 AS target_url,
    ba.title                              AS target_title,
    (ba.status='published')               AS target_published,
    -- cornerstone proxy: longer = more authoritative
    LEAST(1.00, GREATEST(0.40, COALESCE(ba.word_count,0)::numeric / 2000.0))::numeric AS similarity_score
  FROM public.certification_seo_pages csp
  JOIN public.certification_catalog cc
    ON cc.id = csp.certification_catalog_id
  JOIN public.course_packages cp
    ON cp.certification_id = cc.linked_certification_id
   AND cp.status = 'published'
  JOIN public.blog_articles ba
    ON ba.source_curriculum_id = cp.curriculum_id
   AND ba.status = 'published'
  WHERE csp.is_published
),
-- ===== blog_to_exam_package =====
-- blog → course_package (conversion bridge)
btep AS (
  SELECT
    'blog_to_exam_package'::text          AS link_type,
    ba.id::text                           AS source_id,
    'contextual_blog'::text               AS source_layer,
    ('/blog/' || ba.slug)                 AS source_url,
    ba.title                              AS source_title,
    (ba.status='published')               AS source_published,
    cp.id::text                           AS target_id,
    'exam_package'::text                  AS target_layer,
    ('/shop/' || COALESCE(p.slug, cp.id::text)) AS target_url,
    cp.title                              AS target_title,
    (cp.status='published')               AS target_published,
    CASE
      WHEN ba.source_package_id = cp.id THEN 1.00
      WHEN ba.source_curriculum_id IS NOT NULL AND cp.curriculum_id = ba.source_curriculum_id THEN 0.75
      ELSE 0.50
    END::numeric                          AS similarity_score
  FROM public.blog_articles ba
  JOIN public.course_packages cp
    ON (cp.id = ba.source_package_id OR cp.curriculum_id = ba.source_curriculum_id)
   AND cp.status = 'published'
  LEFT JOIN public.products p ON p.id = cp.product_id
  WHERE ba.status = 'published'
),
-- ===== cluster_to_blog (SKELETON — no source data yet) =====
ctb AS (
  SELECT
    'cluster_to_blog'::text AS link_type,
    NULL::text AS source_id, 'cluster_intent'::text AS source_layer,
    NULL::text AS source_url, NULL::text AS source_title, false AS source_published,
    NULL::text AS target_id, 'contextual_blog'::text AS target_layer,
    NULL::text AS target_url, NULL::text AS target_title, false AS target_published,
    0.00::numeric AS similarity_score
  WHERE false  -- no rows; presence guarantees summary row via UNION trick below
),
-- ===== certification_to_learning_content (SKELETON — no target layer) =====
ctlc AS (
  SELECT
    'certification_to_learning_content'::text AS link_type,
    NULL::text AS source_id, 'certification'::text AS source_layer,
    NULL::text AS source_url, NULL::text AS source_title, false AS source_published,
    NULL::text AS target_id, 'learning_content'::text AS target_layer,
    NULL::text AS target_url, NULL::text AS target_title, false AS target_published,
    0.00::numeric AS similarity_score
  WHERE false
),
all_cands AS (
  SELECT * FROM btp
  UNION ALL SELECT * FROM ptcb
  UNION ALL SELECT * FROM btep
  UNION ALL SELECT * FROM ctb
  UNION ALL SELECT * FROM ctlc
),
ranked AS (
  SELECT
    ac.*,
    ROW_NUMBER() OVER (PARTITION BY ac.link_type, ac.source_id ORDER BY ac.similarity_score DESC, ac.target_id) AS source_rank
  FROM all_cands ac
),
dedupe AS (
  SELECT
    r.*,
    EXISTS (
      SELECT 1 FROM public.seo_internal_link_suggestions sils
       WHERE sils.source_url = r.source_url
         AND sils.target_url = r.target_url
         AND sils.link_type  = r.link_type
         AND sils.status IN ('active','suggested','approved')
    ) AS duplicate_existing,
    g.max_outbound_per_source,
    g.min_semantic_similarity
  FROM ranked r
  LEFT JOIN gov g ON g.link_type = r.link_type
)
SELECT
  link_type,
  source_id, source_layer, source_url, source_title, source_published,
  target_id, target_layer, target_url, target_title, target_published,
  similarity_score,
  source_rank,
  duplicate_existing,
  max_outbound_per_source,
  min_semantic_similarity,
  CASE
    WHEN source_id IS NULL                                           THEN 'NO_SOURCE_LAYER_DATA'
    WHEN target_id IS NULL                                           THEN 'NO_TARGET_LAYER_DATA'
    WHEN NOT source_published OR NOT target_published                THEN 'BLOCKED_UNPUBLISHED'
    WHEN duplicate_existing                                          THEN 'BLOCKED_DUPLICATE_EXISTING'
    WHEN similarity_score < COALESCE(min_semantic_similarity, 0.50)  THEN 'BLOCKED_BELOW_MIN_SIMILARITY'
    WHEN source_rank > COALESCE(max_outbound_per_source, 3)          THEN 'BLOCKED_SOURCE_CAP'
    ELSE 'READY'
  END::text AS decision
FROM dedupe;

REVOKE ALL ON public.v_seo_bridge_candidates_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_seo_bridge_candidates_v1 TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 2) Summary view (per link_type KPIs)
-- ─────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_seo_bridge_candidates_summary_v1 CASCADE;

CREATE VIEW public.v_seo_bridge_candidates_summary_v1 AS
WITH base AS (
  SELECT btr.link_type,
         btr.source_layer        AS gov_source_layer,
         btr.target_layer        AS gov_target_layer,
         btr.is_active           AS type_is_active,
         g.max_outbound_per_source,
         g.min_semantic_similarity,
         g.requires_admin_approval
    FROM public.seo_bridge_type_registry btr
    LEFT JOIN public.seo_bridge_governance g ON g.link_type = btr.link_type
),
agg AS (
  SELECT
    link_type,
    COUNT(*)                                                       AS candidate_count,
    COUNT(*) FILTER (WHERE decision='READY')                       AS eligible_count,
    COUNT(*) FILTER (WHERE decision LIKE 'BLOCKED_%')              AS blocked_count,
    COUNT(*) FILTER (WHERE decision='BLOCKED_DUPLICATE_EXISTING')  AS blocked_duplicate_count,
    COUNT(*) FILTER (WHERE decision='BLOCKED_BELOW_MIN_SIMILARITY')AS blocked_below_similarity_count,
    COUNT(*) FILTER (WHERE decision='BLOCKED_SOURCE_CAP')          AS blocked_cap_count,
    COUNT(*) FILTER (WHERE decision='BLOCKED_UNPUBLISHED')         AS blocked_unpublished_count,
    COUNT(*) FILTER (WHERE decision='NO_SOURCE_LAYER_DATA')        AS no_source_layer_count,
    COUNT(*) FILTER (WHERE decision='NO_TARGET_LAYER_DATA')        AS no_target_layer_count,
    ROUND(AVG(similarity_score)::numeric, 3)                       AS avg_similarity,
    MIN(similarity_score)                                          AS min_similarity,
    MAX(similarity_score)                                          AS max_similarity,
    COUNT(DISTINCT source_id) FILTER (WHERE decision='READY')      AS distinct_eligible_sources,
    COUNT(DISTINCT target_id) FILTER (WHERE decision='READY')      AS distinct_eligible_targets
  FROM public.v_seo_bridge_candidates_v1
  GROUP BY link_type
)
SELECT
  b.link_type,
  b.gov_source_layer,
  b.gov_target_layer,
  b.type_is_active,
  b.max_outbound_per_source,
  b.min_semantic_similarity,
  b.requires_admin_approval,
  COALESCE(a.candidate_count, 0)                AS candidate_count,
  COALESCE(a.eligible_count, 0)                 AS eligible_count,
  COALESCE(a.blocked_count, 0)                  AS blocked_count,
  COALESCE(a.blocked_duplicate_count, 0)        AS blocked_duplicate_count,
  COALESCE(a.blocked_below_similarity_count, 0) AS blocked_below_similarity_count,
  COALESCE(a.blocked_cap_count, 0)              AS blocked_cap_count,
  COALESCE(a.blocked_unpublished_count, 0)      AS blocked_unpublished_count,
  COALESCE(a.no_source_layer_count, 0)          AS no_source_layer_count,
  COALESCE(a.no_target_layer_count, 0)          AS no_target_layer_count,
  a.avg_similarity,
  a.min_similarity,
  a.max_similarity,
  COALESCE(a.distinct_eligible_sources, 0)      AS distinct_eligible_sources,
  COALESCE(a.distinct_eligible_targets, 0)      AS distinct_eligible_targets
FROM base b
LEFT JOIN agg a ON a.link_type = b.link_type
ORDER BY b.link_type;

REVOKE ALL ON public.v_seo_bridge_candidates_summary_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_seo_bridge_candidates_summary_v1 TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 3) Admin RPCs (has_role-gated)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_bridge_candidates_summary()
RETURNS SETOF public.v_seo_bridge_candidates_summary_v1
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY SELECT * FROM public.v_seo_bridge_candidates_summary_v1;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_bridge_candidates_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_bridge_candidates_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_bridge_candidates_top(
  p_link_type text,
  p_limit int DEFAULT 25,
  p_decision text DEFAULT 'READY'
)
RETURNS TABLE (
  link_type text,
  source_id text, source_layer text, source_url text, source_title text,
  target_id text, target_layer text, target_url text, target_title text,
  similarity_score numeric,
  source_rank int,
  decision text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'p_limit must be 1..500';
  END IF;
  RETURN QUERY
    SELECT v.link_type, v.source_id, v.source_layer, v.source_url, v.source_title,
           v.target_id, v.target_layer, v.target_url, v.target_title,
           v.similarity_score, v.source_rank::int, v.decision
      FROM public.v_seo_bridge_candidates_v1 v
     WHERE v.link_type = p_link_type
       AND (p_decision IS NULL OR v.decision = p_decision)
     ORDER BY v.similarity_score DESC, v.source_rank, v.source_id, v.target_id
     LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_bridge_candidates_top(text,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_bridge_candidates_top(text,int,text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 4) Smoke + initial audit
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_total int; v_eligible int; v_blocked int; v_by jsonb;
BEGIN
  SELECT
    COALESCE(SUM(candidate_count),0),
    COALESCE(SUM(eligible_count),0),
    COALESCE(SUM(blocked_count),0),
    COALESCE(jsonb_object_agg(link_type, jsonb_build_object(
      'candidate_count', candidate_count,
      'eligible_count',  eligible_count,
      'blocked_count',   blocked_count,
      'avg_similarity',  avg_similarity
    )), '{}'::jsonb)
  INTO v_total, v_eligible, v_blocked, v_by
  FROM public.v_seo_bridge_candidates_summary_v1;

  PERFORM public.fn_emit_audit(
    _action_type := 'bridge_candidate_recon_detected',
    _payload := jsonb_build_object(
      'phase', 'E3e.1',
      'candidates_total', v_total,
      'eligible_total', v_eligible,
      'blocked_total', v_blocked,
      'by_link_type', v_by
    )
  );
END $$;

-- Rollback-Hint:
--   DROP FUNCTION public.admin_get_bridge_candidates_top(text,int,text);
--   DROP FUNCTION public.admin_get_bridge_candidates_summary();
--   DROP VIEW public.v_seo_bridge_candidates_summary_v1;
--   DROP VIEW public.v_seo_bridge_candidates_v1;
--   DELETE FROM ops_audit_contract WHERE action_type='bridge_candidate_recon_detected';