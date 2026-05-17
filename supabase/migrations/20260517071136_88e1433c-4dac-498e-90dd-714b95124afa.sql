DROP FUNCTION IF EXISTS public.admin_get_catalog_visibility_drift();

CREATE FUNCTION public.admin_get_catalog_visibility_drift()
RETURNS TABLE (
  package_id      uuid,
  package_key     text,
  title           text,
  status          text,
  is_published    boolean,
  has_active_product boolean,
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
    SELECT cp.id AS pkg_id, cp.package_key AS pkg_key, cp.title AS pkg_title, cp.status AS pkg_status,
           cp.is_published AS pkg_is_pub, cp.product_id
    FROM public.course_packages cp
    WHERE cp.status = 'published'
  ),
  enriched AS (
    SELECT b.*,
      EXISTS (SELECT 1 FROM public.products p WHERE p.id = b.product_id AND p.status = 'active') AS f_prod,
      EXISTS (SELECT 1 FROM public.product_prices pp
              WHERE pp.product_id = b.product_id AND pp.active = true AND pp.stripe_price_id IS NOT NULL) AS f_price,
      (c.package_id IS NOT NULL) AS f_cat,
      COALESCE(c.is_published,false) AS f_catpub
    FROM base b
    LEFT JOIN public.v_full_course_catalog c ON c.package_id = b.pkg_id
  )
  SELECT
    e.pkg_id, e.pkg_key, e.pkg_title, e.pkg_status, e.pkg_is_pub,
    e.f_prod, e.f_price, e.f_cat, e.f_catpub,
    (
      CASE WHEN NOT e.f_prod   THEN ARRAY['NO_ACTIVE_PRODUCT']        ELSE ARRAY[]::text[] END
      || CASE WHEN NOT e.f_price  THEN ARRAY['NO_ACTIVE_PRICE']          ELSE ARRAY[]::text[] END
      || CASE WHEN NOT e.f_cat    THEN ARRAY['MISSING_FROM_CATALOG_VIEW'] ELSE ARRAY[]::text[] END
      || CASE WHEN e.f_cat AND NOT e.f_catpub THEN ARRAY['CATALOG_NOT_PUBLISHED'] ELSE ARRAY[]::text[] END
      || CASE WHEN NOT e.pkg_is_pub THEN ARRAY['PACKAGE_FLAG_NOT_PUBLISHED'] ELSE ARRAY[]::text[] END
    ) AS gate_reasons
  FROM enriched e
  ORDER BY e.pkg_title;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_catalog_visibility_drift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_catalog_visibility_drift() TO authenticated, service_role;