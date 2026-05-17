CREATE OR REPLACE FUNCTION public.admin_get_catalog_visibility_drift()
RETURNS TABLE (
  package_id      uuid,
  package_key     text,
  title           text,
  status          text,
  is_published    boolean,
  has_product     boolean,
  has_active_price boolean,
  in_full_catalog boolean,
  catalog_is_published boolean,
  gate_reasons    text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT cp.id AS package_id, cp.package_key, cp.title, cp.status,
           cp.is_published, cp.product_id, cp.curriculum_id
    FROM public.course_packages cp
    WHERE cp.status = 'published'
  ),
  enriched AS (
    SELECT b.*,
      (b.product_id IS NOT NULL) AS f_has_product,
      EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = b.product_id AND p.is_active = true AND p.stripe_price_id IS NOT NULL
      ) AS f_has_active_price,
      c.package_id IS NOT NULL AS f_in_catalog,
      COALESCE(c.is_published, false) AS f_catalog_pub
    FROM base b
    LEFT JOIN public.v_full_course_catalog c ON c.package_id = b.package_id
  )
  SELECT
    e.package_id, e.package_key, e.title, e.status, e.is_published,
    e.f_has_product, e.f_has_active_price, e.f_in_catalog, e.f_catalog_pub,
    (
      CASE WHEN NOT e.f_has_product       THEN ARRAY['NO_PRODUCT']                 ELSE ARRAY[]::text[] END
      || CASE WHEN NOT e.f_has_active_price THEN ARRAY['NO_ACTIVE_PRICE']            ELSE ARRAY[]::text[] END
      || CASE WHEN NOT e.f_in_catalog       THEN ARRAY['MISSING_FROM_CATALOG_VIEW']  ELSE ARRAY[]::text[] END
      || CASE WHEN e.f_in_catalog AND NOT e.f_catalog_pub
                                            THEN ARRAY['CATALOG_NOT_PUBLISHED']      ELSE ARRAY[]::text[] END
      || CASE WHEN NOT e.is_published       THEN ARRAY['PACKAGE_FLAG_NOT_PUBLISHED'] ELSE ARRAY[]::text[] END
    ) AS gate_reasons
  FROM enriched e
  ORDER BY array_length((
    CASE WHEN NOT e.f_has_product       THEN ARRAY['NO_PRODUCT']                 ELSE ARRAY[]::text[] END
    || CASE WHEN NOT e.f_has_active_price THEN ARRAY['NO_ACTIVE_PRICE']            ELSE ARRAY[]::text[] END
    || CASE WHEN NOT e.f_in_catalog       THEN ARRAY['MISSING_FROM_CATALOG_VIEW']  ELSE ARRAY[]::text[] END
    || CASE WHEN e.f_in_catalog AND NOT e.f_catalog_pub
                                          THEN ARRAY['CATALOG_NOT_PUBLISHED']      ELSE ARRAY[]::text[] END
    || CASE WHEN NOT e.is_published       THEN ARRAY['PACKAGE_FLAG_NOT_PUBLISHED'] ELSE ARRAY[]::text[] END
  ), 1) DESC NULLS LAST, e.title;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_catalog_visibility_drift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_catalog_visibility_drift() TO authenticated, service_role;

-- Audit via contract
SELECT public.fn_emit_audit(
  'catalog_visibility_drift_inspected','system',NULL,'success',
  jsonb_build_object('migration','catalog_visibility_drift_recon_v1','rpc','admin_get_catalog_visibility_drift'),
  'migration', NULL);