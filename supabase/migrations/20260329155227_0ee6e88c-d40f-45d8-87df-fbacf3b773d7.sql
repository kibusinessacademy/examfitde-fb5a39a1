
-- Phase 2: Bridge RPC for curriculum-based access via product system
-- Bridges old curriculum_id-based access to new product_id-based system
-- Falls back to legacy feature-flags during transition

CREATE OR REPLACE FUNCTION public.check_product_access_by_curriculum(
  p_user_id uuid,
  p_curriculum_id uuid,
  p_feature text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_has_access boolean := false;
BEGIN
  -- Path 1: Try new product-based access
  SELECT p.id INTO v_product_id
  FROM public.products p
  WHERE p.curriculum_id = p_curriculum_id
    AND p.status = 'active'
  LIMIT 1;

  IF v_product_id IS NOT NULL THEN
    v_has_access := public.can_access_product(p_user_id, v_product_id);
    IF v_has_access THEN
      RETURN true;
    END IF;
  END IF;

  -- Path 2: Fallback to legacy feature-flags
  IF p_feature IS NOT NULL THEN
    RETURN public.check_user_entitlement(p_user_id, p_curriculum_id, p_feature);
  END IF;

  -- Path 3: Any legacy entitlement for this curriculum
  RETURN EXISTS (
    SELECT 1 FROM public.entitlements e
    WHERE e.curriculum_id = p_curriculum_id
      AND e.user_id = p_user_id
      AND e.valid_from <= now()
      AND (e.valid_until IS NULL OR e.valid_until >= now())
      AND (
        COALESCE(e.has_learning_course, false) OR
        COALESCE(e.has_exam_trainer, false) OR
        COALESCE(e.has_ai_tutor, false) OR
        COALESCE(e.has_oral_trainer, false)
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_product_access_by_curriculum(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_product_access_by_curriculum(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_product_access_by_curriculum(uuid, uuid, text) TO service_role;

-- RPC to get product catalog with channel config
CREATE OR REPLACE FUNCTION public.get_product_catalog(
  p_channel text DEFAULT 'web'
)
RETURNS TABLE (
  id uuid,
  slug text,
  title text,
  subtitle text,
  description text,
  product_type text,
  certification_id uuid,
  curriculum_id uuid,
  visibility text,
  channel_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.slug,
    p.title,
    p.subtitle,
    p.description,
    p.product_type,
    p.certification_id,
    p.curriculum_id,
    p.visibility,
    COALESCE(pcc.is_enabled, false) AS channel_enabled
  FROM public.products p
  LEFT JOIN public.product_channel_configs pcc
    ON pcc.product_id = p.id AND pcc.channel = p_channel
  WHERE p.status = 'active'
    AND p.visibility IN ('public', 'enterprise_only')
  ORDER BY p.slug;
$$;

REVOKE ALL ON FUNCTION public.get_product_catalog(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_catalog(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_catalog(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_product_catalog(text) TO service_role;

-- RPC to get product detail with current version
CREATE OR REPLACE FUNCTION public.get_product_detail(
  p_slug text
)
RETURNS TABLE (
  id uuid,
  slug text,
  title text,
  subtitle text,
  description text,
  product_type text,
  certification_id uuid,
  curriculum_id uuid,
  visibility text,
  status text,
  version_id uuid,
  version_tag text,
  release_notes text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.slug,
    p.title,
    p.subtitle,
    p.description,
    p.product_type,
    p.certification_id,
    p.curriculum_id,
    p.visibility,
    p.status,
    pv.id AS version_id,
    pv.version_tag,
    pv.release_notes
  FROM public.products p
  LEFT JOIN public.product_versions pv
    ON pv.product_id = p.id AND pv.is_current = true
  WHERE p.slug = p_slug
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_product_detail(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_detail(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_detail(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_product_detail(text) TO service_role;
