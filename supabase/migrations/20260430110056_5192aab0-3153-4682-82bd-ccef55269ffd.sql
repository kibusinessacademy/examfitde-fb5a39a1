-- Mapping-View: SEO-Landingpages → Kategorie-URL + Produkt-URL
CREATE OR REPLACE VIEW public.v_certification_seo_with_product
WITH (security_invoker = true)
AS
WITH seo AS (
  SELECT
    sp.id,
    sp.slug,
    sp.title,
    sp.is_published,
    sp.certification_catalog_id,
    cc.catalog_type,
    cc.track,
    regexp_replace(sp.slug, '-pruefung$', '') AS slug_base
  FROM public.certification_seo_pages sp
  LEFT JOIN public.certification_catalog cc
    ON cc.id = sp.certification_catalog_id
  WHERE sp.is_published = true
),
prod AS (
  SELECT
    canonical_slug,
    canonical_title,
    package_id,
    regexp_replace(canonical_slug, '-[0-9a-f]{8}$', '') AS slug_base
  FROM public.v_product_page_published_ssot
)
SELECT
  s.id,
  s.slug AS seo_slug,
  s.title,
  s.catalog_type,
  s.track,
  -- Kategorie-Ableitung
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
  -- Produkt-Match (best effort)
  p.canonical_slug AS product_slug,
  CASE WHEN p.canonical_slug IS NOT NULL
       THEN '/pruefungstraining/' || p.canonical_slug
       ELSE NULL
  END AS product_url_path,
  p.package_id AS product_package_id
FROM seo s
LEFT JOIN prod p ON p.slug_base = s.slug_base;

-- Helper RPC für Cockpit/Frontend
CREATE OR REPLACE FUNCTION public.get_certification_seo_with_product(p_slug text)
RETURNS TABLE (
  seo_slug text,
  title text,
  category_key text,
  canonical_url_path text,
  product_slug text,
  product_url_path text,
  product_package_id uuid
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
    v.product_package_id
  FROM public.v_certification_seo_with_product v
  WHERE v.seo_slug = p_slug
  LIMIT 1;
$$;

GRANT SELECT ON public.v_certification_seo_with_product TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_certification_seo_with_product(text) TO anon, authenticated;