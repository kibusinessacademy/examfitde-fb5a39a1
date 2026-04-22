-- ═══════════════════════════════════════════════════════════════════
-- P0 SECURITY: Allowlist-based anon privilege model
-- ═══════════════════════════════════════════════════════════════════
-- Defense-in-Depth: anon may only SELECT explicit whitelist objects.
-- All INSERT/UPDATE/DELETE removed. Authenticated path unchanged.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Hard revoke all DML from anon on every existing public table/view ──
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass::text AS obj
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON %s FROM anon', r.obj);
  END LOOP;
END$$;

-- ── 2) Revoke SELECT from anon on EVERYTHING in public ──
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass::text AS obj
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p')
  LOOP
    EXECUTE format('REVOKE SELECT ON %s FROM anon', r.obj);
  END LOOP;
END$$;

-- ── 3) Re-grant SELECT only on the public allowlist ──
-- Marketing / catalog / SEO storefront content
DO $$
DECLARE
  whitelist text[] := ARRAY[
    -- Public catalog
    'courses','certification_catalog','curricula','learning_fields',
    'course_packages','competencies','beruf_aliases','berufe',
    -- Marketing storefront
    'blog_articles','blog_posts','marketing_assets','marketing_campaigns','marketing_plans',
    'pricing_plans','pricing_rules','product_page_overrides',
    -- SEO public surfaces
    'seo_content_pages','seo_documents','seo_internal_link_suggestions',
    'seo_keyword_clusters','seo_keywords','seo_redirects','seo_settings','seo_templates',
    -- Public SSOT views
    'v_course_display_ssot','v_full_course_catalog','v_homepage_course_catalog',
    'v_latest_course_package','v_learner_visible_exam_simulations',
    'v_product_page_published_ssot','v_product_page_ssot'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY whitelist LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname=t) THEN
      EXECUTE format('GRANT SELECT ON public.%I TO anon', t);
    END IF;
  END LOOP;
END$$;

-- ── 4) Lock future objects: default privileges deny anon by default ──
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon;

-- ── 5) Audit log ──
INSERT INTO public.admin_notifications (title, body, severity, category, metadata)
VALUES (
  'P0 Security: Anon Allowlist enforced',
  'Removed INSERT/UPDATE/DELETE from anon on all public tables; SELECT restricted to 28-object whitelist (courses, marketing, SEO, public SSOT views).',
  'high','security',
  jsonb_build_object('migration','anon_allowlist_lockdown_v2','timestamp', now())
);

-- ── 6) Allowlist registry table for runtime audits ──
CREATE TABLE IF NOT EXISTS public.security_anon_allowlist (
  object_name text PRIMARY KEY,
  object_kind text NOT NULL,
  reason text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.security_anon_allowlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read allowlist" ON public.security_anon_allowlist
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

INSERT INTO public.security_anon_allowlist (object_name, object_kind, reason) VALUES
  ('courses','table','public catalog'),
  ('certification_catalog','table','public catalog'),
  ('curricula','table','public catalog'),
  ('learning_fields','table','public catalog'),
  ('course_packages','table','public catalog'),
  ('competencies','table','public catalog'),
  ('beruf_aliases','table','SEO routing'),
  ('berufe','table','SEO routing'),
  ('blog_articles','table','marketing storefront'),
  ('blog_posts','table','marketing storefront'),
  ('marketing_assets','table','marketing storefront'),
  ('marketing_campaigns','table','marketing storefront'),
  ('marketing_plans','table','marketing storefront'),
  ('pricing_plans','table','public pricing'),
  ('pricing_rules','table','public pricing'),
  ('product_page_overrides','table','product pages'),
  ('seo_content_pages','table','SEO storefront'),
  ('seo_documents','table','SEO storefront'),
  ('seo_internal_link_suggestions','table','SEO storefront'),
  ('seo_keyword_clusters','table','SEO storefront'),
  ('seo_keywords','table','SEO storefront'),
  ('seo_redirects','table','SEO storefront'),
  ('seo_settings','table','SEO storefront'),
  ('seo_templates','table','SEO storefront'),
  ('v_course_display_ssot','view','public SSOT'),
  ('v_full_course_catalog','view','public SSOT'),
  ('v_homepage_course_catalog','view','public SSOT'),
  ('v_latest_course_package','view','public SSOT'),
  ('v_learner_visible_exam_simulations','view','public SSOT'),
  ('v_product_page_published_ssot','view','public SSOT'),
  ('v_product_page_ssot','view','public SSOT')
ON CONFLICT (object_name) DO NOTHING;