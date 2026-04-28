CREATE OR REPLACE FUNCTION public.check_product_access_by_curriculum(
  p_user_id uuid,
  p_curriculum_id uuid,
  p_feature text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid;
BEGIN
  -- Path C (early): Admin role bypass — admins access everything,
  -- regardless of product status (incl. draft/internal curricula).
  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id AND ur.role = 'admin'
  ) THEN
    RETURN true;
  END IF;

  -- Path D (early): Active learner_course_grant — Loop-C SSOT.
  -- Grants are issued by trg_orders_paid_grant / grant_learner_course_access
  -- and are independent of products.status.
  IF EXISTS (
    SELECT 1 FROM public.learner_course_grants g
    WHERE g.user_id = p_user_id
      AND g.curriculum_id = p_curriculum_id
      AND g.status = 'active'
  ) THEN
    RETURN true;
  END IF;

  -- Standard path: product-based access via curriculum_id mapping
  SELECT p.id INTO v_product_id
  FROM public.products p
  WHERE p.curriculum_id = p_curriculum_id
    AND p.status = 'active'
  LIMIT 1;

  IF v_product_id IS NOT NULL THEN
    RETURN public.can_access_product(p_user_id, v_product_id);
  END IF;

  RETURN false;
END;
$function$;