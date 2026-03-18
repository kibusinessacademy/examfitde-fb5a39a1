
DROP FUNCTION IF EXISTS public.recompute_package_progress(uuid);

CREATE FUNCTION public.recompute_package_progress(p_package_id uuid DEFAULT NULL)
RETURNS TABLE(
  package_id uuid,
  old_progress numeric,
  new_progress numeric,
  drift numeric,
  updated boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH targets AS (
    SELECT
      cp.id AS pkg_id,
      cp.build_progress::numeric AS old_prog,
      COALESCE(abp.real_progress, 0)::numeric AS real_prog
    FROM course_packages cp
    LEFT JOIN ops_artifact_build_progress abp ON abp.package_id = cp.id
    WHERE cp.status = 'building'
      AND (p_package_id IS NULL OR cp.id = p_package_id)
  ),
  do_update AS (
    UPDATE course_packages cp2
    SET build_progress = ROUND(t.real_prog)::int,
        updated_at = now()
    FROM targets t
    WHERE cp2.id = t.pkg_id
      AND ABS(cp2.build_progress - t.real_prog) > 2
    RETURNING cp2.id AS updated_id
  )
  SELECT
    t.pkg_id,
    t.old_prog,
    t.real_prog,
    (t.real_prog - t.old_prog),
    EXISTS(SELECT 1 FROM do_update u WHERE u.updated_id = t.pkg_id)
  FROM targets t
  ORDER BY (t.real_prog - t.old_prog) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_package_progress(uuid) TO service_role;
