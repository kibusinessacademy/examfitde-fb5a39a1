
-- ═══════════════════════════════════════════════════════════════
-- P1: recompute_package_progress — SSOT progress from artifacts
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.recompute_package_progress(p_package_id uuid DEFAULT NULL)
RETURNS TABLE(
  package_id uuid,
  old_progress integer,
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
      cp.build_progress AS old_prog,
      COALESCE(abp.real_progress, 0) AS real_prog
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
      AND ABS(cp2.build_progress - t.real_prog) > 2  -- Only update if drift > 2%
    RETURNING cp2.id AS updated_id
  )
  SELECT
    t.pkg_id AS package_id,
    t.old_prog AS old_progress,
    t.real_prog AS new_progress,
    (t.real_prog - t.old_prog) AS drift,
    EXISTS(SELECT 1 FROM do_update u WHERE u.updated_id = t.pkg_id) AS updated
  FROM targets t
  ORDER BY (t.real_prog - t.old_prog) DESC;
END;
$$;

-- Grant execute to service_role
GRANT EXECUTE ON FUNCTION public.recompute_package_progress(uuid) TO service_role;
