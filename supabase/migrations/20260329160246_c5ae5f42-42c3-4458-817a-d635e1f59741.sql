-- Phase 3A: Strip legacy fallbacks from bridge RPC
-- Since 100% of entitlements have product_id, Path 2+3 are dead code.
-- The bridge now ONLY resolves via new product system.

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
BEGIN
  -- Single path: product-based access via curriculum_id mapping
  SELECT p.id INTO v_product_id
  FROM public.products p
  WHERE p.curriculum_id = p_curriculum_id
    AND p.status = 'active'
  LIMIT 1;

  IF v_product_id IS NOT NULL THEN
    RETURN public.can_access_product(p_user_id, v_product_id);
  END IF;

  -- No product found for this curriculum → no access
  RETURN false;
END;
$$;

-- Restrict execution to authenticated + service_role only
REVOKE ALL ON FUNCTION public.check_product_access_by_curriculum(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_product_access_by_curriculum(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_product_access_by_curriculum(uuid, uuid, text) TO service_role;