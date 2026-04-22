
-- ============================================================
-- P0 Security Hotfix: Anon-Privilege Lockdown
-- ============================================================
-- Ziel: Anon darf NUR explizit als öffentlich freigegebene
-- Marketing/Catalog-Objekte lesen. Alle anderen Tabellen/Views
-- werden für anon gesperrt (REVOKE). RLS bleibt zusätzlicher
-- Defense-in-Depth-Schutz.
-- ============================================================

DO $$
DECLARE
  -- Whitelist legitimer öffentlicher Read-Objekte
  v_public_relnames text[] := ARRAY[
    'courses','certification_catalog','curricula','learning_fields','competencies',
    'course_packages','beruf_definitions','berufe','beruf_aliases',
    'blog_posts','blog_articles',
    'pricing_plans','pricing_rules','product_page_overrides',
    'marketing_assets','marketing_campaigns','marketing_plans',
    'seo_content_pages','seo_documents','seo_keywords','seo_keyword_clusters',
    'seo_redirects','seo_internal_link_suggestions','seo_settings','seo_templates',
    'v_homepage_course_catalog','v_product_page_published_ssot','v_product_page_ssot',
    'v_full_course_catalog','v_course_display_ssot','v_latest_course_package',
    'v_learner_visible_exam_simulations'
  ];
  r record;
BEGIN
  -- 1) REVOKE alle Privilegien von anon auf public.* (Tabellen, Views, MViews)
  FOR r IN
    SELECT c.oid, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relkind IN ('r','v','m','p')
      AND NOT (c.relname = ANY(v_public_relnames))
      AND (
        has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE')
        OR has_table_privilege('anon', c.oid, 'DELETE')
      )
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.relname);
  END LOOP;

  -- 2) Sicherstellen: Whitelist hat SELECT für anon
  FOREACH r.relname IN ARRAY v_public_relnames LOOP
    BEGIN
      EXECUTE format('GRANT SELECT ON public.%I TO anon', r.relname);
    EXCEPTION WHEN undefined_table THEN
      -- ignorieren falls Objekt nicht existiert
      NULL;
    END;
  END LOOP;

  -- 3) REVOKE EXECUTE auf alle SECURITY DEFINER Admin-Funktionen von anon
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.prosecdef = true
      AND has_function_privilege('anon', p.oid, 'EXECUTE') = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, r.args);
  END LOOP;

  -- 4) Default Privileges: künftige Tabellen/Views/Functions standardmäßig NICHT für anon
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon';
END $$;

-- Audit-Log
INSERT INTO admin_notifications (severity, category, title, body, entity_type, metadata)
VALUES (
  'critical',
  'security',
  'P0 Security Hotfix: Anon-Privilege Lockdown',
  'Alle anon-Privilegien auf public.* (außer expliziter Marketing-Whitelist) wurden entzogen. SECURITY DEFINER Funktionen sind nicht mehr von anon ausführbar. Default Privileges für anon revoked.',
  'security',
  jsonb_build_object(
    'fix','anon_privilege_lockdown_v1',
    'scope','public schema',
    'whitelist_kept', ARRAY['courses','certification_catalog','curricula','learning_fields',
                            'course_packages','blog_posts','pricing_plans','seo_content_pages',
                            'v_homepage_course_catalog','v_product_page_published_ssot',
                            'v_full_course_catalog']
  )
);
