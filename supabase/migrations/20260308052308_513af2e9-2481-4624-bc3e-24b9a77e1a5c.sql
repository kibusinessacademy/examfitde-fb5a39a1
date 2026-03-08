
-- Fix: enqueue_integrity_rechecks should only target building/done/published packages
-- Root cause: nightly backfill was enqueueing integrity checks for queued/blocked packages,
-- which were then mass-failed by ops_hygiene_cleanup

CREATE OR REPLACE FUNCTION public.enqueue_integrity_rechecks(
  p_cap int DEFAULT 150,
  p_reason text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap int := GREATEST(10, LEAST(COALESCE(p_cap,150), 500));
  v_inserted int := 0;
  v_candidates int := 0;
BEGIN
  WITH candidates AS (
    SELECT cp.id, cp.curriculum_id
    FROM public.course_packages cp
    WHERE
      -- ✅ FIX: Only target packages in eligible statuses
      cp.status IN ('building', 'done', 'published', 'draft')
      AND (
        cp.integrity_report IS NULL
        OR (
          (cp.integrity_report->>'legacy_report') IS DISTINCT FROM 'true'
          AND (
            cp.integrity_report::text LIKE '%/500%'
            OR cp.integrity_report::text LIKE '%<40\%%'
          )
        )
        OR (cp.status = 'quality_gate_failed' AND cp.track = 'EXAM_FIRST')
      )
    ORDER BY cp.updated_at DESC
    LIMIT v_cap
  ),
  ins AS (
    INSERT INTO public.job_queue (job_type, status, payload, package_id, worker_pool, priority, max_attempts)
    SELECT
      'package_run_integrity_check',
      'pending',
      jsonb_build_object(
        'packageId', c.id::text,
        'curriculum_id', c.curriculum_id::text,
        'reason', p_reason
      ),
      c.id,
      'core',
      70,
      3
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.job_queue jq
      WHERE jq.job_type = 'package_run_integrity_check'
        AND jq.status IN ('pending', 'processing', 'enqueued')
        AND jq.payload->>'packageId' = c.id::text
    )
    RETURNING 1
  )
  SELECT
    (SELECT COUNT(*) FROM candidates),
    (SELECT COUNT(*) FROM ins)
  INTO v_candidates, v_inserted;

  RETURN jsonb_build_object(
    'cap', v_cap,
    'candidates', v_candidates,
    'enqueued', v_inserted
  );
END;
$$;

-- Also fix: ops_hygiene_cleanup writes to 'error' but monitoring reads 'last_error'
-- Update the hygiene cleanup to write to last_error as well
CREATE OR REPLACE FUNCTION public.ops_hygiene_cleanup(
  p_max_lease_cleanup int DEFAULT 200,
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
  -- ✅ FIX: Write to both 'error' AND 'last_error' so monitoring can see the reason
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
