DROP FUNCTION IF EXISTS public.get_certification_seo_with_product(text);
DROP VIEW IF EXISTS public.v_certification_seo_with_product;

CREATE OR REPLACE VIEW public.v_certification_seo_with_product
WITH (security_invoker = true)
AS
WITH seo AS (
  SELECT
    sp.id,
    sp.slug,
    sp.title,
    sp.certification_catalog_id,
    cc.catalog_type,
    cc.track,
    cc.slug                          AS catalog_slug,
    cc.linked_certification_id,
    regexp_replace(sp.slug, '-pruefung$', '') AS slug_base
  FROM public.certification_seo_pages sp
  LEFT JOIN public.certification_catalog cc
    ON cc.id = sp.certification_catalog_id
  WHERE sp.is_published = true
),
prod AS (
  SELECT
    package_id,
    canonical_slug,
    canonical_title,
    regexp_replace(canonical_slug, '-[0-9a-f]{8}$', '') AS slug_base
  FROM public.v_product_page_published_ssot
),
-- (1) ID-first: seo.cat_id → cat.linked_cert_id → course_packages.certification_id
m_id AS (
  SELECT s.id AS seo_id, p.package_id, p.canonical_slug, 'id_chain'::text AS source
  FROM seo s
  JOIN public.course_packages cp
    ON cp.certification_id = s.linked_certification_id
   AND cp.status = 'published'
  JOIN prod p ON p.package_id = cp.id
  WHERE s.linked_certification_id IS NOT NULL
),
-- (2) Catalog-Slug → certifications.slug → course_packages.certification_id
m_catalog_slug AS (
  SELECT s.id AS seo_id, p.package_id, p.canonical_slug, 'catalog_slug'::text AS source
  FROM seo s
  JOIN public.certifications c
    ON c.slug = s.catalog_slug
  JOIN public.course_packages cp
    ON cp.certification_id = c.id
   AND cp.status = 'published'
  JOIN prod p ON p.package_id = cp.id
  WHERE s.id NOT IN (SELECT seo_id FROM m_id)
),
-- (3) Slug-Base-Regex Fallback
m_slug_base AS (
  SELECT s.id AS seo_id, p.package_id, p.canonical_slug, 'slug_base'::text AS source
  FROM seo s
  JOIN prod p ON p.slug_base = s.slug_base
  WHERE s.id NOT IN (SELECT seo_id FROM m_id)
    AND s.id NOT IN (SELECT seo_id FROM m_catalog_slug)
),
matches AS (
  SELECT * FROM m_id
  UNION ALL SELECT * FROM m_catalog_slug
  UNION ALL SELECT * FROM m_slug_base
)
SELECT
  s.id,
  s.slug AS seo_slug,
  s.title,
  s.catalog_type,
  s.track,
  CASE
    WHEN s.slug ~ '^(itil|prince2|psm|pspo|scrum)' THEN 'projektmanagement'
    WHEN s.catalog_type = 'Fortbildung_IHK' THEN 'fachwirt'
    WHEN s.catalog_type = 'Meister' THEN 'meister'
    WHEN s.catalog_type = 'Branchenzertifikat' THEN 'sachkunde'
    ELSE 'ausbildung'
  END AS category_key,
  '/' ||
  CASE
    WHEN s.slug ~ '^(itil|prince2|psm|pspo|scrum)' THEN 'projektmanagement'
    WHEN s.catalog_type = 'Fortbildung_IHK' THEN 'fachwirt'
    WHEN s.catalog_type = 'Meister' THEN 'meister'
    WHEN s.catalog_type = 'Branchenzertifikat' THEN 'sachkunde'
    ELSE 'ausbildung'
  END || '/' || s.slug AS canonical_url_path,
  m.canonical_slug AS product_slug,
  CASE WHEN m.canonical_slug IS NOT NULL
       THEN '/pruefungstraining/' || m.canonical_slug
       ELSE NULL
  END AS product_url_path,
  m.package_id AS product_package_id,
  COALESCE(m.source, 'unmatched') AS mapping_source
FROM seo s
LEFT JOIN matches m ON m.seo_id = s.id;

CREATE OR REPLACE FUNCTION public.get_certification_seo_with_product(p_slug text)
RETURNS TABLE (
  seo_slug text,
  title text,
  category_key text,
  canonical_url_path text,
  product_slug text,
  product_url_path text,
  product_package_id uuid,
  mapping_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.seo_slug,
    v.title,
    v.category_key,
    v.canonical_url_path,
    v.product_slug,
    v.product_url_path,
    v.product_package_id,
    v.mapping_source
  FROM public.v_certification_seo_with_product v
  WHERE v.seo_slug = p_slug
  LIMIT 1;
$$;

GRANT SELECT ON public.v_certification_seo_with_product TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_certification_seo_with_product(text) TO anon, authenticated;