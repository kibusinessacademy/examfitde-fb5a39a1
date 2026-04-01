-- Fix ops_hygiene_cleanup: include blocked/quality_gate_failed in the exclusion list
-- so repair jobs for packages in these states are not killed by the hygiene sweep.
CREATE OR REPLACE FUNCTION public.ops_hygiene_cleanup(
  p_max_lease_cleanup int DEFAULT 100,
  p_max_job_cleanup int DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orphan_leases INT := 0;
  v_non_building_jobs INT := 0;
  v_idle_leases INT := 0;
BEGIN
  WITH orphan_candidates AS (
    SELECT pl.package_id
    FROM public.package_leases pl
    WHERE NOT EXISTS (
      SELECT 1 FROM public.course_packages cp
      WHERE cp.id = pl.package_id
        AND cp.status IN ('building', 'council_review')
    )
    LIMIT p_max_lease_cleanup
  ), deleted AS (
    DELETE FROM public.package_leases pl
    USING orphan_candidates oc
    WHERE pl.package_id = oc.package_id
    RETURNING pl.package_id
  )
  SELECT count(*) INTO v_orphan_leases FROM deleted;

  WITH idle_candidates AS (
    SELECT pl.package_id
    FROM public.package_leases pl
    WHERE NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = pl.package_id
        AND jq.status IN ('pending', 'processing')
    )
    AND (
      (pl.renewed_at IS NOT NULL AND pl.renewed_at < now() - interval '10 minutes')
      OR (pl.renewed_at IS NULL AND pl.lease_until > now() + interval '20 minutes')
      OR pl.lease_until < now()
    )
    LIMIT p_max_lease_cleanup
  ), idle_deleted AS (
    DELETE FROM public.package_leases pl
    USING idle_candidates ic
    WHERE pl.package_id = ic.package_id
    RETURNING pl.package_id
  )
  SELECT count(*) INTO v_idle_leases FROM idle_deleted;

  -- Cancel pending/processing jobs for non-building packages
  -- FIXED: Also exclude blocked/quality_gate_failed since repair jobs legitimately run in those states
  WITH job_candidates AS (
    SELECT jq.id
    FROM public.job_queue jq
    JOIN public.course_packages cp ON cp.id = jq.package_id
    WHERE jq.status IN ('pending', 'processing')
      AND jq.package_id IS NOT NULL
      AND cp.status NOT IN ('building', 'council_review', 'blocked', 'quality_gate_failed')
    LIMIT p_max_job_cleanup
  ), cleaned AS (
    UPDATE public.job_queue jq
    SET status = 'failed',
        error = 'OPS_GUARD:NON_BUILDING_PACKAGE',
        last_error = ' | OPS_GUARD:NON_BUILDING_PACKAGE',
        completed_at = now(),
        updated_at = now(),
        locked_at = null,
        locked_by = null
    FROM job_candidates jc
    WHERE jq.id = jc.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_non_building_jobs FROM cleaned;

  IF (v_orphan_leases + v_idle_leases + v_non_building_jobs) > 0 THEN
    INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, metadata)
    VALUES (
      'Hygiene Cleanup Executed',
      format('Cleaned %s orphan leases, %s idle leases, %s non-building jobs',
        v_orphan_leases, v_idle_leases, v_non_building_jobs),
      'ops', 'info', 'system',
      jsonb_build_object(
        'orphan_leases_removed', v_orphan_leases,
        'idle_leases_removed', v_idle_leases,
        'non_building_jobs_failed', v_non_building_jobs
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'orphan_leases_removed', v_orphan_leases,
    'idle_leases_removed', v_idle_leases,
    'non_building_jobs_failed', v_non_building_jobs
  );
END;
$$;