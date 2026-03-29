-- Phase 3B: Drop audit view first (depends on legacy columns), then columns, then old RPCs

-- 1. Drop dependent view
DROP VIEW IF EXISTS public.v_entitlement_migration_audit;

-- 2. Drop legacy feature-flag columns
ALTER TABLE public.entitlements
  DROP COLUMN IF EXISTS has_learning_course,
  DROP COLUMN IF EXISTS has_exam_trainer,
  DROP COLUMN IF EXISTS has_ai_tutor,
  DROP COLUMN IF EXISTS has_oral_trainer,
  DROP COLUMN IF EXISTS has_handbook;

-- 3. Drop deprecated RPCs
DROP FUNCTION IF EXISTS public.check_user_entitlement(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.get_user_entitlements(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_user_entitlements_v2(uuid, uuid);

-- 4. Recreate audit view without legacy columns
CREATE OR REPLACE VIEW public.v_entitlement_migration_audit AS
SELECT
  (SELECT count(*) FROM public.entitlements) AS total_entitlements,
  (SELECT count(*) FROM public.entitlements WHERE product_id IS NOT NULL) AS with_product_id,
  (SELECT count(*) FROM public.entitlements WHERE product_id IS NULL) AS without_product_id,
  (SELECT count(*) FROM public.entitlements e
   LEFT JOIN public.products p ON p.id = e.product_id
   WHERE e.product_id IS NOT NULL AND p.id IS NULL) AS orphaned_entitlements,
  (SELECT count(*) FROM (
    SELECT product_id FROM public.product_versions WHERE is_current = true
    GROUP BY product_id HAVING count(*) > 1
  ) x) AS duplicate_current_count,
  (SELECT count(*) FROM public.org_license_assignments ola
   LEFT JOIN public.org_licenses ol ON ol.id = ola.org_license_id
   WHERE ola.status = 'active'
     AND (ol.id IS NULL OR ol.status <> 'active' OR (ol.ends_at IS NOT NULL AND ol.ends_at < now()))
  ) AS orphaned_assignments;