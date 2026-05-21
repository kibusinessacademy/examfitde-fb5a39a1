CREATE OR REPLACE VIEW public.v_blog_sitemap_entries AS
WITH a AS (
  SELECT ba.slug, GREATEST(ba.updated_at, ba.published_at) AS lastmod, 'blog_articles'::text AS source
  FROM public.blog_articles ba
  WHERE ba.status='published' AND ba.slug IS NOT NULL
),
p AS (
  SELECT bp.slug, GREATEST(bp.updated_at, bp.published_at) AS lastmod, 'blog_posts'::text AS source
  FROM public.blog_posts bp
  WHERE bp.status='published' AND bp.slug IS NOT NULL AND COALESCE(bp.noindex,false)=false
),
u AS (SELECT slug,lastmod,source FROM a UNION ALL SELECT slug,lastmod,source FROM p)
SELECT DISTINCT ON (slug) slug, lastmod, source FROM u
ORDER BY slug, lastmod DESC NULLS LAST;

REVOKE ALL ON public.v_blog_sitemap_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_blog_sitemap_entries TO service_role;

CREATE OR REPLACE VIEW public.v_wissen_sitemap_entries AS
WITH cur AS (
  SELECT id, published_at FROM public.semantic_graph_snapshots
  WHERE status='published' ORDER BY published_at DESC NULLS LAST LIMIT 1
),
graph AS (
  SELECT ('/wissen/'||e.kind||'/'||e.key)::text AS path,
         COALESCE(cur.published_at, now()) AS lastmod,
         ('semantic:'||e.kind)::text AS source
  FROM public.semantic_graph_entities e CROSS JOIN cur
  WHERE e.snapshot_id = cur.id
    AND e.kind IN ('beruf','kompetenz','pruefung')
    AND e.key IS NOT NULL
),
docs AS (
  SELECT ('/wissen/'||d.slug)::text AS path,
         GREATEST(d.updated_at, d.published_at) AS lastmod,
         'seo_documents'::text AS source
  FROM public.seo_documents d
  WHERE d.status='published' AND d.slug IS NOT NULL AND d.doc_type IS DISTINCT FROM 'landing'
),
u AS (SELECT path,lastmod,source FROM graph UNION ALL SELECT path,lastmod,source FROM docs)
SELECT DISTINCT ON (path) path, lastmod, source FROM u
ORDER BY path, lastmod DESC NULLS LAST;

REVOKE ALL ON public.v_wissen_sitemap_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_wissen_sitemap_entries TO service_role;

CREATE OR REPLACE VIEW public.v_pruefungstraining_sitemap_entries AS
WITH landing AS (
  SELECT d.slug, GREATEST(d.updated_at,d.published_at) AS lastmod, 'seo_documents.landing'::text AS source
  FROM public.seo_documents d
  WHERE d.status='published' AND d.doc_type='landing' AND d.slug IS NOT NULL
),
certs AS (
  SELECT c.slug, COALESCE(c.created_at, now()) AS lastmod, 'certification_catalog'::text AS source
  FROM public.certification_catalog c WHERE c.slug IS NOT NULL
),
u AS (SELECT slug,lastmod,source FROM landing UNION ALL SELECT slug,lastmod,source FROM certs)
SELECT DISTINCT ON (slug) slug, lastmod, source FROM u
ORDER BY slug, lastmod DESC NULLS LAST;

REVOKE ALL ON public.v_pruefungstraining_sitemap_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pruefungstraining_sitemap_entries TO service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES (
  'sitemap_class_counts',
  ARRAY['static','berufe','paket','blog','wissen','pruefungstraining','content','total'],
  'seo.sitemap'
)
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module  = EXCLUDED.owner_module,
      updated_at    = now();