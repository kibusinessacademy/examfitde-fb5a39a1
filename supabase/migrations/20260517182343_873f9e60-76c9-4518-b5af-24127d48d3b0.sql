-- E3d.0 — Blog Publish Readiness Recon (read-only SSOT)
-- Concern: Klassifikation. Keine Mutationen. Keine Publish-Logik.

CREATE OR REPLACE VIEW public.v_blog_publish_readiness AS
WITH base AS (
  SELECT
    d.id                          AS blog_id,
    d.doc_type,
    d.slug,
    d.title,
    d.status,
    d.qc_score,
    d.qc_report,
    d.similarity_group,
    d.beruf_id,
    d.curriculum_id,
    d.competency_id,
    d.published_at,
    d.created_at,
    d.updated_at,
    (d.meta_title IS NOT NULL    AND length(btrim(d.meta_title))    > 0) AS has_meta_title,
    (d.meta_description IS NOT NULL AND length(btrim(d.meta_description)) > 0) AS has_meta_description,
    (d.canonical_url IS NOT NULL AND length(btrim(d.canonical_url)) > 0) AS has_canonical,
    (d.slug IS NOT NULL          AND length(btrim(d.slug))          > 0) AS has_slug,
    COALESCE(length(d.content_md), 0)                              AS content_char_len,
    -- ~5 chars/word as conservative German estimate
    (COALESCE(length(d.content_md), 0) / 5)::int                   AS word_count_est,
    COALESCE(jsonb_array_length(NULLIF(d.internal_links, 'null'::jsonb)), 0) AS embedded_link_count
  FROM public.seo_documents d
),
url_map AS (
  -- spiegelt docTypeUrlMap im Frontend
  SELECT
    b.blog_id,
    CASE b.doc_type
      WHEN 'blog'    THEN '/blog/'   || b.slug
      WHEN 'faq'     THEN '/faq/'    || b.slug
      WHEN 'landing' THEN '/'        || b.slug
      ELSE '/'                       || b.slug
    END AS canonical_path
  FROM base b
),
ils AS (
  SELECT
    um.blog_id,
    COUNT(*) FILTER (WHERE s.status='active')                                          AS active_inbound,
    COUNT(*) FILTER (WHERE s.status='suggested')                                       AS suggested_inbound,
    COUNT(*) FILTER (WHERE s.status='suggested' AND s.link_type='contextual')          AS suggested_contextual_inbound,
    COUNT(*) FILTER (WHERE s.source_url=um.canonical_path)                             AS outbound_total
  FROM url_map um
  LEFT JOIN public.seo_internal_link_suggestions s
    ON s.target_url=um.canonical_path OR s.source_url=um.canonical_path
  GROUP BY um.blog_id
),
dup AS (
  SELECT b.blog_id,
         CASE
           WHEN b.similarity_group IS NULL THEN 0
           ELSE (SELECT COUNT(*) FROM public.seo_documents d2
                  WHERE d2.similarity_group = b.similarity_group) - 1
         END AS duplicate_peers
  FROM base b
),
governance AS (
  SELECT b.blog_id,
         COALESCE((b.qc_report->>'manual_review_required')::boolean, false)
           OR COALESCE((b.qc_report->>'unsafe_html')::boolean,        false)
           OR COALESCE((b.qc_report->>'hallucination_flag')::boolean, false)
           OR COALESCE((b.qc_report->>'empty_sections')::boolean,     false)
           OR COALESCE((b.qc_report->>'invalid_schema')::boolean,     false)
           AS hard_governance_block
  FROM base b
),
joined AS (
  SELECT b.*, um.canonical_path,
         COALESCE(ils.active_inbound, 0)               AS active_inbound,
         COALESCE(ils.suggested_inbound, 0)            AS suggested_inbound,
         COALESCE(ils.suggested_contextual_inbound,0)  AS suggested_contextual_inbound,
         COALESCE(ils.outbound_total, 0)               AS outbound_total,
         COALESCE(dup.duplicate_peers, 0)              AS duplicate_peers,
         COALESCE(governance.hard_governance_block,false) AS hard_governance_block
  FROM base b
  JOIN url_map     um         ON um.blog_id  = b.blog_id
  LEFT JOIN ils                ON ils.blog_id = b.blog_id
  LEFT JOIN dup                ON dup.blog_id = b.blog_id
  LEFT JOIN governance         ON governance.blog_id = b.blog_id
),
classified AS (
  SELECT
    j.*,
    -- decision (priority order)
    CASE
      WHEN j.status='published'                                       THEN 'ALREADY_PUBLISHED'
      WHEN j.hard_governance_block                                    THEN 'MANUAL_REVIEW_REQUIRED'
      WHEN j.qc_score IS NOT NULL AND j.qc_score < 80                 THEN 'QUALITY_TOO_LOW'
      WHEN NOT j.has_slug
        OR NOT j.has_meta_title
        OR NOT j.has_meta_description
        OR NOT j.has_canonical                                        THEN 'MISSING_SEO_META'
      WHEN j.word_count_est < 800                                     THEN 'THIN_CONTENT'
      WHEN j.duplicate_peers > 0                                      THEN 'DUPLICATE_RISK'
      WHEN j.suggested_inbound = 0 AND j.outbound_total = 0
        AND j.embedded_link_count = 0                                 THEN 'INTERNAL_LINKS_MISSING'
      ELSE 'READY_TO_PUBLISH'
    END AS decision
  FROM joined j
)
SELECT
  blog_id, doc_type, slug, title, status, canonical_path,
  qc_score, word_count_est, content_char_len,
  has_slug, has_meta_title, has_meta_description, has_canonical,
  embedded_link_count, active_inbound, suggested_inbound,
  suggested_contextual_inbound, outbound_total,
  duplicate_peers, hard_governance_block,
  beruf_id, curriculum_id, competency_id, similarity_group,
  published_at, created_at, updated_at,
  decision,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN hard_governance_block                                  THEN 'hard_governance_block' END,
    CASE WHEN qc_score IS NOT NULL AND qc_score < 80                 THEN 'qc_score_below_80'    END,
    CASE WHEN NOT has_slug                                           THEN 'missing_slug'         END,
    CASE WHEN NOT has_meta_title                                     THEN 'missing_meta_title'   END,
    CASE WHEN NOT has_meta_description                               THEN 'missing_meta_description' END,
    CASE WHEN NOT has_canonical                                      THEN 'missing_canonical'    END,
    CASE WHEN word_count_est < 800                                   THEN 'thin_content_lt_800w' END,
    CASE WHEN duplicate_peers > 0                                    THEN 'duplicate_peers'      END,
    CASE WHEN suggested_inbound=0 AND outbound_total=0
          AND embedded_link_count=0                                  THEN 'no_internal_links'    END
  ], NULL) AS reasons
FROM classified;

REVOKE ALL ON public.v_blog_publish_readiness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_blog_publish_readiness TO service_role;

-- Summary nach Decision
CREATE OR REPLACE VIEW public.v_blog_publish_blockers_summary AS
SELECT doc_type, decision, COUNT(*)::int AS n
FROM public.v_blog_publish_readiness
GROUP BY doc_type, decision
ORDER BY doc_type, n DESC;

REVOKE ALL ON public.v_blog_publish_blockers_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_blog_publish_blockers_summary TO service_role;

-- Publishability nach Cluster (curriculum_id or beruf_id)
CREATE OR REPLACE VIEW public.v_blog_publishability_by_cluster AS
SELECT
  COALESCE(curriculum_id::text, beruf_id::text, 'NO_CLUSTER') AS cluster_key,
  curriculum_id,
  beruf_id,
  COUNT(*)::int                                            AS docs_total,
  COUNT(*) FILTER (WHERE decision='READY_TO_PUBLISH')::int AS ready,
  COUNT(*) FILTER (WHERE decision='MISSING_SEO_META')::int AS missing_meta,
  COUNT(*) FILTER (WHERE decision='THIN_CONTENT')::int     AS thin,
  COUNT(*) FILTER (WHERE decision='QUALITY_TOO_LOW')::int  AS quality_low,
  COUNT(*) FILTER (WHERE decision='DUPLICATE_RISK')::int   AS duplicate,
  COUNT(*) FILTER (WHERE decision='INTERNAL_LINKS_MISSING')::int AS no_links,
  COUNT(*) FILTER (WHERE decision='MANUAL_REVIEW_REQUIRED')::int AS manual_review,
  COUNT(*) FILTER (WHERE decision='ALREADY_PUBLISHED')::int      AS already_published
FROM public.v_blog_publish_readiness
GROUP BY curriculum_id, beruf_id;

REVOKE ALL ON public.v_blog_publishability_by_cluster FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_blog_publishability_by_cluster TO service_role;

-- Admin RPC: Summary
CREATE OR REPLACE FUNCTION public.admin_get_blog_publish_readiness_summary()
RETURNS TABLE (doc_type text, decision text, n int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.doc_type, v.decision, v.n
    FROM public.v_blog_publish_blockers_summary v
   WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
   ORDER BY v.doc_type, v.n DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_blog_publish_readiness_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_blog_publish_readiness_summary() TO authenticated, service_role;

-- Admin RPC: Detail (paged, filterable)
CREATE OR REPLACE FUNCTION public.admin_get_blog_publish_readiness_detail(
  p_decision text DEFAULT NULL,
  p_doc_type text DEFAULT NULL,
  p_limit    int  DEFAULT 100,
  p_offset   int  DEFAULT 0
)
RETURNS TABLE (
  blog_id uuid, doc_type text, slug text, title text, status text,
  canonical_path text, qc_score int, word_count_est int,
  active_inbound int, suggested_inbound int, embedded_link_count int,
  duplicate_peers int, decision text, reasons text[],
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.blog_id, v.doc_type, v.slug, v.title, v.status,
         v.canonical_path, v.qc_score, v.word_count_est,
         v.active_inbound, v.suggested_inbound, v.embedded_link_count,
         v.duplicate_peers, v.decision, v.reasons, v.updated_at
    FROM public.v_blog_publish_readiness v
   WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
     AND (p_decision IS NULL OR v.decision = p_decision)
     AND (p_doc_type IS NULL OR v.doc_type = p_doc_type)
   ORDER BY v.doc_type, v.decision, v.updated_at DESC
   LIMIT GREATEST(1, LEAST(p_limit, 500))
  OFFSET GREATEST(0, p_offset);
$$;

REVOKE ALL ON FUNCTION public.admin_get_blog_publish_readiness_detail(text,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_blog_publish_readiness_detail(text,text,int,int) TO authenticated, service_role;