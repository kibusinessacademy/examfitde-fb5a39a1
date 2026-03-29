
-- =====================================================
-- PHASE 1 HARDENING PASS
-- =====================================================

-- 1. PRODUCTS RLS: Visibility-based read access
-- Products mit visibility='public' oder 'active' status sind für alle authenticated lesbar
-- Private/enterprise_only nur über Entitlement oder Org-Zugehörigkeit
CREATE POLICY "Authenticated can read public/active products"
  ON public.products FOR SELECT TO authenticated
  USING (
    visibility = 'public'
    OR status = 'active'
    OR EXISTS (
      SELECT 1 FROM public.entitlements e
      WHERE e.product_id = products.id
        AND e.user_id = auth.uid()
        AND e.valid_from <= now()
        AND (e.valid_until IS NULL OR e.valid_until >= now())
    )
  );

-- Anon users can see public products (for landing pages)
CREATE POLICY "Anon can read public products"
  ON public.products FOR SELECT TO anon
  USING (visibility = 'public' AND status = 'active');

-- 2. ENTITLEMENTS RLS: Add org-scope read for learner_identity_id
CREATE POLICY "Users can view entitlements via learner identity"
  ON public.entitlements FOR SELECT TO authenticated
  USING (
    learner_identity_id IN (
      SELECT id FROM public.learner_identities WHERE user_id = auth.uid()
    )
  );

-- 3. FIX can_access_product() — proper status check + org_license path + search_path
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

    -- Path B: Org license assignment
    SELECT 1
    FROM public.org_license_assignments ola
    JOIN public.org_licenses ol ON ol.id = ola.org_license_id
    JOIN public.learner_identities li ON li.id = ola.learner_identity_id
    WHERE ol.product_id = p_product_id
      AND ol.status = 'active'
      AND ol.starts_at <= now()
      AND (ol.ends_at IS NULL OR ol.ends_at >= now())
      AND ola.status = 'active'
      AND li.user_id = p_user_id

    LIMIT 1
  );
$$;

-- Restrict execute to authenticated only
REVOKE ALL ON FUNCTION public.can_access_product(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_product(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_product(uuid, uuid) TO service_role;

-- 4. AUDIT VIEW: Migration health check
CREATE OR REPLACE VIEW public.v_entitlement_migration_audit AS
WITH legacy_stats AS (
  SELECT
    count(*) AS total_entitlements,
    count(*) FILTER (WHERE product_id IS NOT NULL) AS with_product_id,
    count(*) FILTER (WHERE product_id IS NULL) AS without_product_id,
    count(*) FILTER (WHERE product_id IS NULL AND (
      COALESCE(has_learning_course, false) OR
      COALESCE(has_exam_trainer, false) OR
      COALESCE(has_ai_tutor, false) OR
      COALESCE(has_oral_trainer, false)
    )) AS legacy_active_no_product
  FROM public.entitlements
),
orphan_product_refs AS (
  SELECT count(*) AS orphaned_entitlements
  FROM public.entitlements e
  LEFT JOIN public.products p ON p.id = e.product_id
  WHERE e.product_id IS NOT NULL AND p.id IS NULL
),
duplicate_current_versions AS (
  SELECT count(*) AS duplicate_current_count
  FROM (
    SELECT product_id
    FROM public.product_versions
    WHERE is_current = true
    GROUP BY product_id
    HAVING count(*) > 1
  ) sub
),
orphan_assignments AS (
  SELECT count(*) AS orphaned_assignments
  FROM public.org_license_assignments ola
  LEFT JOIN public.org_licenses ol ON ol.id = ola.org_license_id
  WHERE ola.status = 'active'
    AND (ol.id IS NULL OR ol.status != 'active' OR (ol.ends_at IS NOT NULL AND ol.ends_at < now()))
)
SELECT
  ls.total_entitlements,
  ls.with_product_id,
  ls.without_product_id,
  ls.legacy_active_no_product,
  opr.orphaned_entitlements,
  dcv.duplicate_current_count,
  oa.orphaned_assignments
FROM legacy_stats ls, orphan_product_refs opr, duplicate_current_versions dcv, orphan_assignments oa;

-- Restrict audit view to service_role only
REVOKE SELECT ON public.v_entitlement_migration_audit FROM anon, authenticated;

-- 5. GUARD: Ensure only one current version per product
CREATE OR REPLACE FUNCTION public.trg_guard_single_current_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_current = true THEN
    UPDATE public.product_versions
    SET is_current = false, updated_at = now()
    WHERE product_id = NEW.product_id
      AND id != NEW.id
      AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_single_current_version
  BEFORE INSERT OR UPDATE OF is_current ON public.product_versions
  FOR EACH ROW
  WHEN (NEW.is_current = true)
  EXECUTE FUNCTION public.trg_guard_single_current_version();

-- 6. Add COMMENT deprecation markers on legacy columns
COMMENT ON COLUMN public.entitlements.has_learning_course IS 'DEPRECATED: Use product_id + can_access_product(). Will be removed in Phase 3.';
COMMENT ON COLUMN public.entitlements.has_exam_trainer IS 'DEPRECATED: Use product_id + can_access_product(). Will be removed in Phase 3.';
COMMENT ON COLUMN public.entitlements.has_ai_tutor IS 'DEPRECATED: Use product_id + can_access_product(). Will be removed in Phase 3.';
COMMENT ON COLUMN public.entitlements.has_oral_trainer IS 'DEPRECATED: Use product_id + can_access_product(). Will be removed in Phase 3.';
COMMENT ON COLUMN public.entitlements.has_handbook IS 'DEPRECATED: Use product_id + can_access_product(). Will be removed in Phase 3.';
