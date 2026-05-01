
CREATE OR REPLACE FUNCTION public.admin_heal_published_product_status(p_apply boolean DEFAULT false)
RETURNS TABLE (
  product_id uuid,
  product_title text,
  product_status_before text,
  product_status_after text,
  package_id uuid,
  package_title text,
  action text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  CREATE TEMP TABLE _heal_candidates ON COMMIT DROP AS
  SELECT
    pr.id   AS product_id,
    pr.title AS product_title,
    pr.status AS product_status_before,
    cp.id   AS package_id,
    cp.title AS package_title
  FROM course_packages cp
  JOIN products pr ON pr.id = cp.product_id
  WHERE cp.status = 'published'
    AND pr.status <> 'active';

  IF NOT p_apply THEN
    RETURN QUERY
    SELECT c.product_id, c.product_title, c.product_status_before,
           'active'::text AS product_status_after,
           c.package_id, c.package_title,
           'preview_would_activate'::text AS action
    FROM _heal_candidates c
    ORDER BY c.product_title;
    RETURN;
  END IF;

  -- Apply
  UPDATE products pr
  SET status = 'active', updated_at = now()
  WHERE pr.id IN (SELECT product_id FROM _heal_candidates);

  RETURN QUERY
  SELECT c.product_id, c.product_title, c.product_status_before,
         'active'::text AS product_status_after,
         c.package_id, c.package_title,
         'applied_activated'::text AS action
  FROM _heal_candidates c
  ORDER BY c.product_title;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_heal_published_product_status(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_heal_published_product_status(boolean) TO service_role;
