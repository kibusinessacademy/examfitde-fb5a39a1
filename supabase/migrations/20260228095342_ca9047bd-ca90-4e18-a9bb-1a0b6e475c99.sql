CREATE OR REPLACE FUNCTION public.ops_hygiene_cleanup(
  p_max_lease_cleanup INT DEFAULT 50,
  p_max_job_cleanup INT DEFAULT 200
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orphan_leases INT := 0;
  v_non_building_jobs INT := 0;
  v_idle_leases INT := 0;
BEGIN
  -- 1) Remove leases for packages that are not building (bounded)
  WITH orphan_candidates AS (
    SELECT pl.package_id
    FROM public.package_leases pl
    WHERE NOT EXISTS (
      SELECT 1 FROM public.course_packages cp
      WHERE cp.id = pl.package_id
        AND cp.status = 'building'
    )
    LIMIT p_max_lease_cleanup
  ), deleted AS (
    DELETE FROM public.package_leases pl
    USING orphan_candidates oc
    WHERE pl.package_id = oc.package_id
    RETURNING pl.package_id
  )
  SELECT count(*) INTO v_orphan_leases FROM deleted;

  -- 2) Remove idle leases (no active jobs) that are clearly stale/suspicious (bounded)
  WITH idle_candidates AS (
    SELECT pl.package_id
    FROM public.package_leases pl
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.job_queue jq
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

  -- 3) Fail active jobs belonging to non-building packages (bounded)
  WITH job_candidates AS (
    SELECT jq.id
    FROM public.job_queue jq
    JOIN public.course_packages cp ON cp.id = jq.package_id
    WHERE jq.status IN ('pending', 'processing')
      AND jq.package_id IS NOT NULL
      AND cp.status <> 'building'
    LIMIT p_max_job_cleanup
  ), cleaned AS (
    UPDATE public.job_queue jq
    SET status = 'failed',
        error = 'OPS_GUARD:NON_BUILDING_PACKAGE',
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
      'ops',
      'info',
      'system',
      jsonb_build_object(
        'orphan_leases_removed', v_orphan_leases,
        'idle_leases_removed', v_idle_leases,
        'non_building_jobs_failed', v_non_building_jobs,
        'source', 'ops_hygiene_cleanup'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'orphan_leases_removed', v_orphan_leases,
    'idle_leases_removed', v_idle_leases,
    'non_building_jobs_failed', v_non_building_jobs,
    'ts', now()
  );
END;
$$;