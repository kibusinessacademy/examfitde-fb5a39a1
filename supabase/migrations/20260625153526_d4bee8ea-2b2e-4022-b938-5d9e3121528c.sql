
CREATE OR REPLACE FUNCTION public.public_sell_drift_audit()
RETURNS TABLE (
  product_id uuid,
  product_slug text,
  title text,
  curriculum_id uuid,
  reason text,
  lessons_sellable boolean,
  has_stripe_price boolean,
  modules integer,
  lessons integer,
  lessons_ready integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS product_id,
    p.slug AS product_slug,
    p.title,
    p.curriculum_id,
    CASE
      WHEN v.product_id IS NULL THEN 'missing_from_sellable_view'
      WHEN COALESCE(v.lessons_sellable, false) = false AND COALESCE(v.lessons, 0) = 0 THEN 'no_lessons'
      WHEN COALESCE(v.lessons_sellable, false) = false THEN 'lessons_not_sellable'
      WHEN COALESCE(v.has_stripe_price, false) = false THEN 'no_stripe_price'
      ELSE 'unknown_block'
    END AS reason,
    COALESCE(v.lessons_sellable, false),
    COALESCE(v.has_stripe_price, false),
    COALESCE(v.modules, 0),
    COALESCE(v.lessons, 0),
    COALESCE(v.lessons_ready, 0)
  FROM public.products p
  LEFT JOIN public.v_public_sellable_courses v ON v.product_id = p.id
  WHERE p.status = 'active'
    AND p.visibility = 'public'
    AND COALESCE(v.is_sellable, false) = false
$$;

REVOKE ALL ON FUNCTION public.public_sell_drift_audit() FROM public;
GRANT EXECUTE ON FUNCTION public.public_sell_drift_audit() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.public_sell_drift_audit() IS
  'CI-Gate: lists active+public products that are not sellable. Empty result = no sell-drift.';
