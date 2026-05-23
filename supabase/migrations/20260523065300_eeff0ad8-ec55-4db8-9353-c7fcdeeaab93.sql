
CREATE OR REPLACE VIEW public.v_seo_content_node_ssot AS
WITH
seo_doc AS (
  SELECT
    ('seo_document:' || id::text) AS node_id,
    'seo_document'::text AS node_type,
    'seo_documents'::text AS source_table,
    id AS source_id,
    NULLIF(slug, '') AS canonical_slug,
    title,
    NULL::text AS persona,
    NULL::uuid AS product_id,
    NULL::uuid AS package_id,
    beruf_id,
    curriculum_id,
    status,
    (status = 'published') AS is_indexable,
    CASE WHEN status = 'published' AND slug IS NOT NULL AND slug <> ''
         THEN 'https://examfit.de/' || slug ELSE NULL END AS canonical_url,
    updated_at, created_at,
    jsonb_build_object('doc_type', doc_type, 'language', language, 'qc_score', qc_score, 'competency_id', competency_id) AS metadata
  FROM public.seo_documents
),
blog AS (
  SELECT
    ('blog_article:' || id::text), 'blog_article'::text, 'blog_articles'::text,
    id, NULLIF(slug, ''), title, NULL::text,
    source_package_id, source_package_id, beruf_id, source_curriculum_id,
    status, (status = 'published'),
    CASE WHEN status = 'published' AND slug IS NOT NULL AND slug <> ''
         THEN 'https://examfit.de/blog/' || slug ELSE NULL END,
    updated_at, created_at,
    jsonb_build_object('article_type', article_type, 'topic_cluster', topic_cluster, 'target_keyword', target_keyword, 'competency_id', competency_id, 'word_count', word_count, 'performance_score', performance_score)
  FROM public.blog_articles
),
cert_page AS (
  SELECT
    ('certification_page:' || id::text), 'certification_page'::text, 'certification_seo_pages'::text,
    id, NULLIF(slug, ''), title, NULL::text,
    NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
    CASE WHEN is_published THEN 'published' ELSE 'draft' END,
    COALESCE(is_published, false),
    CASE WHEN is_published AND slug IS NOT NULL AND slug <> ''
         THEN 'https://examfit.de/' || slug ELSE NULL END,
    updated_at, created_at,
    jsonb_build_object('certification_catalog_id', certification_catalog_id, 'page_type', page_type, 'quality_score', quality_score, 'word_count', word_count)
  FROM public.certification_seo_pages
),
content_page AS (
  SELECT
    ('seo_content_page:' || id::text), 'seo_content_page'::text, 'seo_content_pages'::text,
    id, NULLIF(slug, ''), title, NULLIF(persona_type::text, ''),
    NULL::uuid, package_id, NULL::uuid, curriculum_id,
    status, (status = 'published'),
    CASE WHEN status = 'published' AND slug IS NOT NULL AND slug <> ''
         THEN 'https://examfit.de/' || slug ELSE NULL END,
    updated_at, created_at,
    jsonb_build_object('page_type', page_type, 'target_audience', target_audience, 'competency_id', competency_id, 'intent_template', intent_template, 'quality_score', quality_score)
  FROM public.seo_content_pages
),
glossary AS (
  SELECT
    ('glossary_page:' || id::text), 'glossary_page'::text, 'profession_glossaries'::text,
    id, NULL::text, profession_name, NULL::text,
    NULL::uuid, NULL::uuid, beruf_id, NULL::uuid,
    'published'::text, false, NULL::text,
    updated_at, created_at,
    jsonb_build_object('version', version, 'token_count', token_count)
  FROM public.profession_glossaries
),
overlay AS (
  SELECT
    ('persona_overlay:' || id::text), 'persona_overlay'::text, 'product_persona_overlays'::text,
    id, NULL::text, COALESCE(seo_title, hero_headline), NULLIF(persona_type::text, ''),
    NULL::uuid, package_id, NULL::uuid, NULL::uuid,
    CASE WHEN active THEN 'active' ELSE 'inactive' END,
    false, NULL::text,
    updated_at, created_at,
    jsonb_build_object('source', source, 'has_pain_points', (pain_points IS NOT NULL), 'has_trust_items', (trust_items IS NOT NULL))
  FROM public.product_persona_overlays
),
pkg AS (
  SELECT
    ('course_package:' || id::text), 'course_package'::text, 'course_packages'::text,
    id, NULLIF(package_key, ''), title, NULL::text,
    product_id, id, NULL::uuid, curriculum_id,
    status, COALESCE(is_published, false), NULL::text,
    updated_at, created_at,
    jsonb_build_object('track', track, 'certification_id', certification_id, 'is_published', is_published, 'package_key', package_key)
  FROM public.course_packages
)
SELECT * FROM seo_doc
UNION ALL SELECT * FROM blog
UNION ALL SELECT * FROM cert_page
UNION ALL SELECT * FROM content_page
UNION ALL SELECT * FROM glossary
UNION ALL SELECT * FROM overlay
UNION ALL SELECT * FROM pkg;

COMMENT ON VIEW public.v_seo_content_node_ssot IS
'SEO Knowledge OS Cut A — read-only Node-SSOT bridging 7 content sources. Detail: mem://strategie/seo-knowledge-os-audit-v1';

REVOKE ALL ON public.v_seo_content_node_ssot FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_seo_content_node_ssot TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_seo_content_node_ssot(
  p_limit int DEFAULT 100,
  p_node_type text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  node_id text, node_type text, source_table text, source_id uuid,
  canonical_slug text, title text, persona text,
  product_id uuid, package_id uuid, beruf_id uuid, curriculum_id uuid,
  status text, is_indexable boolean, canonical_url text,
  updated_at timestamptz, created_at timestamptz, metadata jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    n.node_id, n.node_type, n.source_table, n.source_id,
    n.canonical_slug, n.title, n.persona,
    n.product_id, n.package_id, n.beruf_id, n.curriculum_id,
    n.status, n.is_indexable, n.canonical_url,
    n.updated_at, n.created_at, n.metadata
  FROM public.v_seo_content_node_ssot n
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND (p_node_type IS NULL OR n.node_type = p_node_type)
    AND (
      p_search IS NULL OR p_search = ''
      OR n.title ILIKE '%' || p_search || '%'
      OR COALESCE(n.canonical_slug, '') ILIKE '%' || p_search || '%'
    )
  ORDER BY n.updated_at DESC NULLS LAST
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 1000), 1);
$$;

REVOKE ALL ON FUNCTION public.admin_get_seo_content_node_ssot(int, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_seo_content_node_ssot(int, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_seo_content_node_ssot_summary()
RETURNS TABLE (
  node_type text, total bigint, indexable bigint, with_slug bigint, last_updated timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    n.node_type,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE n.is_indexable)::bigint,
    COUNT(*) FILTER (WHERE n.canonical_slug IS NOT NULL)::bigint,
    MAX(n.updated_at)
  FROM public.v_seo_content_node_ssot n
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  GROUP BY n.node_type
  ORDER BY n.node_type;
$$;

REVOKE ALL ON FUNCTION public.admin_get_seo_content_node_ssot_summary() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_seo_content_node_ssot_summary() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
