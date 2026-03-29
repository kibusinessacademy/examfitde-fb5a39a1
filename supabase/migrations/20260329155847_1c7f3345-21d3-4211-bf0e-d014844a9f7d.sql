
-- Harden check_product_access_by_curriculum: tighten Path 3
-- Path 3 should ONLY fire as last resort and ONLY check the specific curriculum
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
  -- Path 1: New product-based access (preferred)
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

  -- Path 2: Legacy feature-flag check (specific feature)
  IF p_feature IS NOT NULL THEN
    RETURN public.check_user_entitlement(p_user_id, p_curriculum_id, p_feature);
  END IF;

  -- Path 3: Legacy any-access check — ONLY for this specific curriculum
  -- Tightened: requires at least one active feature flag on this exact curriculum
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
