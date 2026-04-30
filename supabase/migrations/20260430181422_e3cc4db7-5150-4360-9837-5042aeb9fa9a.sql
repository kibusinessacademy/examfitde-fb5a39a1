-- =========================================================
-- SEO Dead-End Bulk-Action RPCs (per-row decisions)
-- =========================================================

-- 1) Republish a course package (covers package_not_published)
CREATE OR REPLACE FUNCTION public.admin_seo_republish_package(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_old_status text;
  v_new_status text;
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT status INTO v_old_status FROM public.course_packages WHERE id = p_package_id;
  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'package_not_found: %', p_package_id;
  END IF;

  UPDATE public.course_packages
     SET status = 'published',
         updated_at = now()
   WHERE id = p_package_id
   RETURNING status INTO v_new_status;

  INSERT INTO public.auto_heal_log (action_type, package_id, payload, triggered_by)
  VALUES ('seo_dead_end_republish_package',
          p_package_id,
          jsonb_build_object('old_status', v_old_status, 'new_status', v_new_status, 'caller', v_caller),
          'admin_seo_dead_end_cockpit');

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id,
                            'old_status', v_old_status, 'new_status', v_new_status);
END;
$$;

-- 2) Demote a single seo_content_pages row to draft
CREATE OR REPLACE FUNCTION public.admin_seo_set_page_draft(p_seo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_slug text;
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  UPDATE public.seo_content_pages
     SET status = 'draft',
         updated_at = now()
   WHERE id = p_seo_id
   RETURNING slug INTO v_slug;

  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'seo_page_not_found: %', p_seo_id;
  END IF;

  INSERT INTO public.auto_heal_log (action_type, payload, triggered_by)
  VALUES ('seo_dead_end_set_draft',
          jsonb_build_object('seo_id', p_seo_id, 'slug', v_slug, 'caller', v_caller),
          'admin_seo_dead_end_cockpit');

  RETURN jsonb_build_object('ok', true, 'seo_id', p_seo_id, 'slug', v_slug, 'status', 'draft');
END;
$$;

-- 3) Set product_slug_override on certification_seo_pages
CREATE OR REPLACE FUNCTION public.admin_seo_set_product_override(
  p_seo_id uuid,
  p_product_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_old text;
  v_new text;
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_product_slug IS NULL OR length(trim(p_product_slug)) = 0 THEN
    RAISE EXCEPTION 'invalid_product_slug';
  END IF;

  SELECT product_slug_override INTO v_old
    FROM public.certification_seo_pages WHERE id = p_seo_id;

  UPDATE public.certification_seo_pages
     SET product_slug_override = trim(p_product_slug),
         updated_at = now()
   WHERE id = p_seo_id
   RETURNING product_slug_override INTO v_new;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'cert_seo_not_found: %', p_seo_id;
  END IF;

  INSERT INTO public.auto_heal_log (action_type, payload, triggered_by)
  VALUES ('seo_dead_end_set_product_override',
          jsonb_build_object('seo_id', p_seo_id, 'old_override', v_old, 'new_override', v_new, 'caller', v_caller),
          'admin_seo_dead_end_cockpit');

  RETURN jsonb_build_object('ok', true, 'seo_id', p_seo_id, 'product_slug_override', v_new);
END;
$$;

-- 4) Create a draft course package in a curriculum (operator can publish later)
CREATE OR REPLACE FUNCTION public.admin_seo_create_draft_package(
  p_curriculum_id uuid,
  p_title text,
  p_track text DEFAULT 'EXAM_FIRST'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_pkg_id uuid;
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_curriculum_id IS NULL THEN
    RAISE EXCEPTION 'curriculum_id_required';
  END IF;
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title_required';
  END IF;

  INSERT INTO public.course_packages (curriculum_id, title, track, status)
  VALUES (p_curriculum_id, trim(p_title), p_track, 'draft')
  RETURNING id INTO v_pkg_id;

  INSERT INTO public.auto_heal_log (action_type, package_id, payload, triggered_by)
  VALUES ('seo_dead_end_create_draft_package',
          v_pkg_id,
          jsonb_build_object('curriculum_id', p_curriculum_id, 'title', p_title, 'track', p_track, 'caller', v_caller),
          'admin_seo_dead_end_cockpit');

  RETURN jsonb_build_object('ok', true, 'package_id', v_pkg_id, 'status', 'draft');
END;
$$;

-- Grants
REVOKE ALL ON FUNCTION public.admin_seo_republish_package(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_seo_set_page_draft(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_seo_set_product_override(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_seo_create_draft_package(uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_seo_republish_package(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seo_set_page_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seo_set_product_override(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seo_create_draft_package(uuid, text, text) TO authenticated;