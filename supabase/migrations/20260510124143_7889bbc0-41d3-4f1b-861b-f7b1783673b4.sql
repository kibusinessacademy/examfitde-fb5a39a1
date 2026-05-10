-- Make can_access_product grants-aware (Path D)
-- Aligns with check_product_access_by_curriculum / tutor_access_check / has_storage_entitlement
-- Source of truth: learner_course_grants.status='active' implies all four feature-flags true.
CREATE OR REPLACE FUNCTION public.can_access_product(p_user_id uuid, p_product_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    -- Path C: Admin
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

    -- Path B: Org license seat
    SELECT 1
    FROM public.org_license_seats ols
    JOIN public.org_licenses ol ON ol.id = ols.license_id
    WHERE ols.user_id = p_user_id
      AND ols.released_at IS NULL
      AND ol.product_id = p_product_id
      AND ol.status = 'active'
      AND (ol.ends_at IS NULL OR ol.ends_at > now())

    UNION ALL

    -- Path D: Active learner_course_grant — direct product match
    SELECT 1
    FROM public.learner_course_grants g
    WHERE g.user_id = p_user_id
      AND g.product_id = p_product_id
      AND g.status = 'active'

    UNION ALL

    -- Path D2: Active grant via curriculum mapping (covers grants without product_id)
    SELECT 1
    FROM public.learner_course_grants g
    JOIN public.products p ON p.curriculum_id = g.curriculum_id
    WHERE g.user_id = p_user_id
      AND g.status = 'active'
      AND p.id = p_product_id

    LIMIT 1
  );
$function$;