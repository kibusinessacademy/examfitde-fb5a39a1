
-- ══════════════════════════════════════════════════════════
-- Admin Auto-Entitlement: Admins get access to ALL products
-- ══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_access_product(
  p_user_id uuid,
  p_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- Path C: Admin role bypass — admins access everything
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role = 'admin'

    UNION ALL

    -- Path A: Direct entitlement (user_id or learner_identity)
    SELECT 1
    FROM public.entitlements e
    WHERE e.product_id = p_product_id
      AND e.valid_from <= now()
      AND (e.valid_until IS NULL OR e.valid_until >= now())
      AND (
        e.user_id = p_user_id
        OR e.learner_identity_id IN (
          SELECT li.id FROM public.learner_identities li WHERE li.user_id = p_user_id
        )
      )

    UNION ALL

    -- Path B: Org license via actual seat assignment (SSOT)
    SELECT 1
    FROM public.org_license_seats ols
    JOIN public.org_licenses ol ON ol.id = ols.license_id
    WHERE ols.user_id = p_user_id
      AND ols.released_at IS NULL
      AND ol.product_id = p_product_id
      AND ol.status = 'active'
      AND (ol.ends_at IS NULL OR ol.ends_at > now())

    LIMIT 1
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_product(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_product(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_product(uuid, uuid) TO service_role;

-- Also update check_product_access_by_curriculum to benefit from admin bypass
-- (it calls can_access_product internally, so it already inherits the fix)
