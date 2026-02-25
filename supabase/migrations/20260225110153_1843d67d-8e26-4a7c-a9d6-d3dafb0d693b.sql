-- Centralized SSOT RPC: Only fails a package if truly stale (no lease/jobs/steps)
CREATE OR REPLACE FUNCTION public.guardian_fail_package_if_stale(
  p_package_id uuid,
  p_min_age_minutes int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_age_minutes int;
  v_active_leases int;
  v_active_jobs int;
  v_active_steps int;
  v_rows_updated int := 0;
  v_applied boolean := false;
BEGIN
  -- Age
  SELECT COALESCE(floor(extract(epoch from (now() - cp.updated_at))/60)::int, 0)
  INTO v_age_minutes
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF v_age_minutes IS NULL THEN
    RETURN jsonb_build_object('error', 'package not found', 'pkg_id', p_package_id);
  END IF;

  -- Active leases
  SELECT count(*)::int INTO v_active_leases
  FROM package_leases pl
  WHERE pl.package_id = p_package_id AND pl.lease_until > now();

  -- Active jobs (SSOT via payload->>'package_id')
  SELECT count(*)::int INTO v_active_jobs
  FROM job_queue jq
  WHERE jq.payload->>'package_id' = p_package_id::text
    AND jq.status IN ('pending', 'processing');

  -- Active steps
  SELECT count(*)::int INTO v_active_steps
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status IN ('running', 'enqueued');

  -- Only fail if ALL guards pass
  IF v_age_minutes >= p_min_age_minutes
     AND v_active_leases = 0
     AND v_active_jobs = 0
     AND v_active_steps = 0
  THEN
    UPDATE course_packages
    SET status = 'failed', updated_at = now()
    WHERE id = p_package_id AND status = 'building';

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    v_applied := (v_rows_updated > 0);
  END IF;

  RETURN jsonb_build_object(
    'pkg_id', p_package_id,
    'age_min', v_age_minutes,
    'active_leases', v_active_leases,
    'active_jobs', v_active_jobs,
    'active_steps', v_active_steps,
    'applied', v_applied,
    'reason', CASE WHEN v_applied THEN 'stale_build_no_lease_jobs_steps' ELSE 'guarded' END
  );
END;
$$;

-- Security: only service_role may call this
REVOKE ALL ON FUNCTION public.guardian_fail_package_if_stale(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardian_fail_package_if_stale(uuid, int) FROM anon;
REVOKE ALL ON FUNCTION public.guardian_fail_package_if_stale(uuid, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.guardian_fail_package_if_stale(uuid, int) TO service_role;