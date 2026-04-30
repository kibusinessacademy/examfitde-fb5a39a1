-- 1) AUTO-FILL + HARD-GUARD
CREATE OR REPLACE FUNCTION public.fn_seo_pages_no_dead_end()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_curr uuid;
  v_pkg_status text;
BEGIN
  IF NEW.curriculum_id IS NULL AND NEW.package_id IS NOT NULL THEN
    SELECT cp.curriculum_id, cp.status INTO v_pkg_curr, v_pkg_status
    FROM public.course_packages cp WHERE cp.id = NEW.package_id;
    IF v_pkg_curr IS NOT NULL THEN NEW.curriculum_id := v_pkg_curr; END IF;
  END IF;

  IF NEW.status = 'published' THEN
    IF NEW.package_id IS NULL THEN
      RAISE EXCEPTION 'SEO_DEAD_END: seo_content_pages % cannot be published without package_id (slug=%)', NEW.id, NEW.slug
        USING ERRCODE = '23514';
    END IF;
    SELECT cp.status INTO v_pkg_status FROM public.course_packages cp WHERE cp.id = NEW.package_id;
    IF v_pkg_status IS NULL THEN
      RAISE EXCEPTION 'SEO_DEAD_END: package % does not exist for seo_content_pages % (slug=%)', NEW.package_id, NEW.id, NEW.slug
        USING ERRCODE = '23514';
    END IF;
    IF v_pkg_status <> 'published' THEN
      RAISE EXCEPTION 'SEO_DEAD_END: package % is % (not published) for seo_content_pages % (slug=%)', NEW.package_id, v_pkg_status, NEW.id, NEW.slug
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seo_pages_no_dead_end_iu ON public.seo_content_pages;
CREATE TRIGGER trg_seo_pages_no_dead_end_iu
BEFORE INSERT OR UPDATE OF status, package_id, curriculum_id
ON public.seo_content_pages
FOR EACH ROW EXECUTE FUNCTION public.fn_seo_pages_no_dead_end();

-- 2) DRIFT VIEW
CREATE OR REPLACE VIEW public.v_seo_dead_end_drift AS
SELECT
  'seo_content_pages'::text AS source_table,
  s.id::text AS seo_id, s.slug, s.page_type, s.status,
  s.package_id::text AS package_id, s.curriculum_id::text AS curriculum_id,
  CASE
    WHEN s.package_id IS NULL THEN 'missing_package_id'
    WHEN cp.id IS NULL THEN 'package_not_found'
    WHEN cp.status <> 'published' THEN 'package_not_published'
    WHEN s.curriculum_id IS NULL THEN 'missing_curriculum_id_repairable'
    ELSE 'ok'
  END AS drift_reason,
  (s.package_id IS NOT NULL AND cp.id IS NOT NULL AND cp.status = 'published' AND s.curriculum_id IS NULL) AS auto_repairable
FROM public.seo_content_pages s
LEFT JOIN public.course_packages cp ON cp.id = s.package_id
WHERE s.status = 'published'
  AND (s.package_id IS NULL OR cp.id IS NULL OR cp.status <> 'published' OR s.curriculum_id IS NULL)
UNION ALL
SELECT
  'certification_seo_pages'::text, v.seo_page_id::text, v.seo_slug, 'certification'::text,
  CASE WHEN v.seo_is_published THEN 'published' ELSE 'draft' END,
  v.package_id::text, NULL::text,
  CASE WHEN v.mapping_source = 'unmatched' THEN 'unmatched_no_product'
       WHEN v.package_id IS NULL THEN 'missing_package_id' ELSE 'ok' END,
  false
FROM public.v_certification_seo_with_product v
WHERE v.seo_is_published = true AND (v.mapping_source = 'unmatched' OR v.package_id IS NULL);

-- 3) HEAL RPC
CREATE OR REPLACE FUNCTION public.admin_heal_seo_dead_ends(
  p_unpublish_unfixable boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_repaired int := 0;
  v_unpublished int := 0;
  v_remaining int := 0;
BEGIN
  WITH fix AS (
    UPDATE public.seo_content_pages s
    SET curriculum_id = cp.curriculum_id, updated_at = now()
    FROM public.course_packages cp
    WHERE s.package_id = cp.id AND s.curriculum_id IS NULL AND cp.curriculum_id IS NOT NULL
    RETURNING s.id
  ) SELECT count(*) INTO v_repaired FROM fix;

  IF p_unpublish_unfixable THEN
    WITH downgrade AS (
      UPDATE public.seo_content_pages s
      SET status = 'draft', updated_at = now()
      WHERE s.status = 'published'
        AND (s.package_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.course_packages cp WHERE cp.id = s.package_id AND cp.status = 'published'
        ))
      RETURNING s.id
    ) SELECT count(*) INTO v_unpublished FROM downgrade;
  END IF;

  SELECT count(*) INTO v_remaining FROM public.v_seo_dead_end_drift;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES (
    'seo_dead_end_heal_v1',
    'seo_content_pages',
    CASE WHEN v_remaining = 0 THEN 'green' WHEN v_repaired > 0 OR v_unpublished > 0 THEN 'yellow' ELSE 'noop' END,
    format('repaired=%s unpublished=%s remaining=%s', v_repaired, v_unpublished, v_remaining),
    jsonb_build_object(
      'repaired_curriculum_id', v_repaired,
      'unpublished_unfixable', v_unpublished,
      'remaining_drift', v_remaining,
      'unpublish_unfixable_flag', p_unpublish_unfixable,
      'ran_at', now()
    )
  );

  RETURN jsonb_build_object(
    'repaired_curriculum_id', v_repaired,
    'unpublished_unfixable', v_unpublished,
    'remaining_drift', v_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_heal_seo_dead_ends(boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_heal_seo_dead_ends(boolean) TO service_role;

-- 4) Initial non-destructive heal (repariert die 6)
SELECT public.admin_heal_seo_dead_ends(false);