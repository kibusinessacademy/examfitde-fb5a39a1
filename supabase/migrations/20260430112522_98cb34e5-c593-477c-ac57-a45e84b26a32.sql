
-- Idempotenz: vorhandene Objekte sauber droppen
DROP FUNCTION IF EXISTS public.get_certification_seo_with_product(text) CASCADE;
DROP VIEW IF EXISTS public.v_certification_seo_with_product CASCADE;

-- 1. Override-Spalte
ALTER TABLE public.certification_seo_pages
  ADD COLUMN IF NOT EXISTS product_slug_override text;

COMMENT ON COLUMN public.certification_seo_pages.product_slug_override IS
  'Manueller Override: canonical_slug eines published course_packages für Buy-CTA. Hat Vorrang vor allen automatischen Mappings.';

-- 2. View
CREATE VIEW public.v_certification_seo_with_product AS
WITH base AS (
  SELECT
    csp.id AS seo_page_id,
    csp.slug AS seo_slug,
    csp.title AS seo_title,
    csp.is_published AS seo_is_published,
    csp.product_slug_override,
    csp.certification_catalog_id,
    cc.slug AS catalog_slug,
    cc.title AS catalog_title,
    cc.catalog_type,
    cc.linked_certification_id,
    CASE
      WHEN cc.catalog_type::text = 'Fortbildung_IHK' THEN 'fachwirt'
      WHEN cc.catalog_type::text = 'Meister' THEN 'meister'
      WHEN cc.catalog_type::text = 'Branchenzertifikat' THEN 'sachkunde'
      WHEN cc.slug ~* '^(itil|prince2|psm|pspo|scrum)' THEN 'projektmanagement'
      ELSE 'ausbildung'
    END AS category_segment
  FROM public.certification_seo_pages csp
  LEFT JOIN public.certification_catalog cc ON cc.id = csp.certification_catalog_id
),
m_override AS (
  SELECT b.*, vp.package_id AS pkg_id_override
  FROM base b
  LEFT JOIN public.v_product_page_published_ssot vp
    ON b.product_slug_override IS NOT NULL
   AND vp.canonical_slug = b.product_slug_override
),
m_id_chain AS (
  SELECT m.*,
         CASE WHEN m.pkg_id_override IS NULL AND m.linked_certification_id IS NOT NULL
              THEN (SELECT vp.package_id
                      FROM public.v_product_page_published_ssot vp
                      JOIN public.course_packages cp ON cp.id = vp.package_id
                     WHERE cp.certification_id = m.linked_certification_id
                     LIMIT 1)
         END AS pkg_id_chain
  FROM m_override m
),
m_catalog_slug AS (
  SELECT m.*,
         CASE WHEN m.pkg_id_override IS NULL AND m.pkg_id_chain IS NULL AND m.catalog_slug IS NOT NULL
              THEN (SELECT vp.package_id
                      FROM public.v_product_page_published_ssot vp
                      JOIN public.course_packages cp ON cp.id = vp.package_id
                      JOIN public.certifications c ON c.id = cp.certification_id
                     WHERE c.slug = m.catalog_slug
                     LIMIT 1)
         END AS pkg_id_catalog_slug
  FROM m_id_chain m
),
m_slug_base AS (
  SELECT m.*,
         CASE WHEN m.pkg_id_override IS NULL AND m.pkg_id_chain IS NULL AND m.pkg_id_catalog_slug IS NULL
              THEN (SELECT vp.package_id
                      FROM public.v_product_page_published_ssot vp
                     WHERE vp.canonical_slug ~ ('^' || regexp_replace(m.seo_slug, '-pruefung$', '') || '-[a-f0-9]{8}$')
                     LIMIT 1)
         END AS pkg_id_slug_base
  FROM m_catalog_slug m
),
resolved AS (
  SELECT m.*,
         COALESCE(m.pkg_id_override, m.pkg_id_chain, m.pkg_id_catalog_slug, m.pkg_id_slug_base) AS resolved_pkg_id,
         CASE
           WHEN m.pkg_id_override IS NOT NULL THEN 'meta_override'
           WHEN m.pkg_id_chain IS NOT NULL THEN 'id_chain'
           WHEN m.pkg_id_catalog_slug IS NOT NULL THEN 'catalog_slug'
           WHEN m.pkg_id_slug_base IS NOT NULL THEN 'slug_base'
           ELSE 'unmatched'
         END AS mapping_source
  FROM m_slug_base m
)
SELECT
  r.seo_page_id,
  r.seo_slug,
  r.seo_title,
  r.seo_is_published,
  r.product_slug_override,
  r.certification_catalog_id,
  r.catalog_slug,
  r.catalog_title,
  r.category_segment,
  '/' || r.category_segment || '/' || r.seo_slug AS canonical_url_path,
  r.resolved_pkg_id AS package_id,
  vp.canonical_slug AS package_canonical_slug,
  vp.canonical_title AS package_title,
  CASE WHEN vp.canonical_slug IS NOT NULL
       THEN '/pruefungstraining/' || vp.canonical_slug
       ELSE NULL END AS product_url_path,
  r.mapping_source
FROM resolved r
LEFT JOIN public.v_product_page_published_ssot vp ON vp.package_id = r.resolved_pkg_id;

GRANT SELECT ON public.v_certification_seo_with_product TO anon, authenticated;

CREATE FUNCTION public.get_certification_seo_with_product(p_slug text)
RETURNS SETOF public.v_certification_seo_with_product
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.v_certification_seo_with_product WHERE seo_slug = p_slug LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_certification_seo_with_product(text) TO anon, authenticated;

-- 3. Auto-Publish Trigger
CREATE OR REPLACE FUNCTION public.fn_auto_publish_seo_pages_on_package()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  IF (NEW.status = 'published' AND COALESCE(NEW.integrity_passed, false) = true)
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM NEW.status
          OR OLD.integrity_passed IS DISTINCT FROM NEW.integrity_passed) THEN
    UPDATE public.seo_content_pages
       SET status = 'published', updated_at = now()
     WHERE package_id = NEW.id AND status = 'draft';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      INSERT INTO public.auto_heal_log
        (trigger_source, action_type, target_id, target_type, result_status, metadata)
      VALUES ('trg_auto_publish_seo','auto_publish_seo_pages_v1',
              NEW.id::text,'course_packages','success',
              jsonb_build_object('package_id', NEW.id, 'published_count', v_count,
                                 'integrity_passed', NEW.integrity_passed));
    END IF;
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_seo_pages_auto_publish_on_package ON public.course_packages;
CREATE TRIGGER trg_seo_pages_auto_publish_on_package
  AFTER INSERT OR UPDATE OF status, integrity_passed ON public.course_packages
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_publish_seo_pages_on_package();

-- 4. Admin-RPC
CREATE OR REPLACE FUNCTION public.admin_publish_eligible_seo_pages(p_package_id uuid DEFAULT NULL)
RETURNS TABLE(published_count int, eligible_packages int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_published int := 0; v_eligible int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  WITH upd AS (
    UPDATE public.seo_content_pages sp
       SET status = 'published', updated_at = now()
      FROM public.course_packages cp
     WHERE sp.package_id = cp.id
       AND sp.status = 'draft'
       AND cp.status = 'published'
       AND COALESCE(cp.integrity_passed, false) = true
       AND (p_package_id IS NULL OR sp.package_id = p_package_id)
    RETURNING sp.id, sp.package_id
  )
  SELECT count(*), count(DISTINCT package_id) INTO v_published, v_eligible FROM upd;

  INSERT INTO public.auto_heal_log
    (trigger_source, action_type, target_id, target_type, result_status, metadata)
  VALUES ('admin_ui','auto_publish_seo_pages_v1_manual',
          COALESCE(p_package_id::text, 'all'), 'seo_content_pages', 'success',
          jsonb_build_object('published_count', v_published, 'eligible_packages', v_eligible,
                             'scope', CASE WHEN p_package_id IS NULL THEN 'all' ELSE 'single' END,
                             'executed_by', auth.uid()));
  RETURN QUERY SELECT v_published, v_eligible;
END$$;

GRANT EXECUTE ON FUNCTION public.admin_publish_eligible_seo_pages(uuid) TO authenticated;

-- 5. Initialer Backfill
DO $$
DECLARE v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.seo_content_pages sp
       SET status = 'published', updated_at = now()
      FROM public.course_packages cp
     WHERE sp.package_id = cp.id
       AND sp.status = 'draft'
       AND cp.status = 'published'
       AND COALESCE(cp.integrity_passed, false) = true
    RETURNING sp.id
  )
  SELECT count(*) INTO v_count FROM upd;

  INSERT INTO public.auto_heal_log
    (trigger_source, action_type, target_type, result_status, metadata)
  VALUES ('manual_admin','auto_publish_seo_pages_v1_initial_backfill',
          'seo_content_pages', 'success',
          jsonb_build_object('published_count', v_count, 'executed_at', now()));
END$$;
