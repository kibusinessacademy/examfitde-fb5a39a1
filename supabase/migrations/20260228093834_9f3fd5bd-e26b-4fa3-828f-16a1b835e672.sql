
-- =============================================================
-- Guard 1: DB Trigger – Auto-normalize building↔published drift
-- If a package has published_at set, it MUST NOT stay in 'building'.
-- This trigger fires BEFORE UPDATE and on INSERT to enforce consistency.
-- =============================================================

CREATE OR REPLACE FUNCTION public.guard_building_published_drift()
RETURNS TRIGGER AS $$
BEGIN
  -- If published_at is set and status is still 'building', auto-normalize
  IF NEW.published_at IS NOT NULL AND NEW.status = 'building' THEN
    NEW.status := 'published';
    NEW.last_error := COALESCE(NEW.last_error, '') || ' [AUTO_NORMALIZE:building→published by guard_building_published_drift]';
    NEW.updated_at := now();
    
    -- Log to admin_notifications for visibility
    INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id)
    VALUES (
      'Package Status Auto-Normalized',
      format('Package %s was building with published_at set. Auto-corrected to published.', NEW.id::text),
      'ops',
      'warn',
      'package',
      NEW.id::text
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop if exists to be idempotent
DROP TRIGGER IF EXISTS trg_guard_building_published_drift ON public.course_packages;

CREATE TRIGGER trg_guard_building_published_drift
  BEFORE INSERT OR UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_building_published_drift();

-- =============================================================
-- Guard 2: Scheduled hygiene RPC – clean orphan leases & non-building jobs
-- Called by stuck-scan or cron; returns cleanup summary.
-- =============================================================

CREATE OR REPLACE FUNCTION public.ops_hygiene_cleanup(
  p_max_lease_cleanup INT DEFAULT 50,
  p_max_job_cleanup INT DEFAULT 200
)
RETURNS JSONB AS $$
DECLARE
  v_orphan_leases INT := 0;
  v_non_building_jobs INT := 0;
  v_idle_leases INT := 0;
BEGIN
  -- 2a: Delete leases for non-building packages
  WITH deleted AS (
    DELETE FROM public.package_leases pl
    WHERE NOT EXISTS (
      SELECT 1 FROM public.course_packages cp
      WHERE cp.id = pl.package_id AND cp.status = 'building'
    )
    RETURNING pl.package_id
  )
  SELECT count(*) INTO v_orphan_leases FROM deleted;

  -- 2b: Delete idle leases (no active jobs, renewed > 10 min ago)
  WITH idle AS (
    DELETE FROM public.package_leases pl
    WHERE pl.package_id IN (
      SELECT pl2.package_id FROM public.package_leases pl2
      WHERE NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.package_id = pl2.package_id
          AND jq.status IN ('pending', 'processing')
      )
      AND (
        (pl2.renewed_at IS NOT NULL AND pl2.renewed_at < now() - interval '10 minutes')
        OR (pl2.renewed_at IS NULL AND pl2.expires_at > now() + interval '20 minutes')
      )
      LIMIT p_max_lease_cleanup
    )
    RETURNING pl.package_id
  )
  SELECT count(*) INTO v_idle_leases FROM idle;

  -- 2c: Fail pending/processing jobs for non-building packages
  WITH cleaned AS (
    UPDATE public.job_queue
    SET status = 'failed',
        error = 'OPS_HYGIENE:PACKAGE_NOT_BUILDING',
        completed_at = now(),
        updated_at = now()
    WHERE id IN (
      SELECT jq.id FROM public.job_queue jq
      JOIN public.course_packages cp ON cp.id = jq.package_id
      WHERE jq.status IN ('pending', 'processing')
        AND jq.package_id IS NOT NULL
        AND cp.status != 'building'
      LIMIT p_max_job_cleanup
    )
    RETURNING id
  )
  SELECT count(*) INTO v_non_building_jobs FROM cleaned;

  -- Alert if any cleanup happened
  IF (v_orphan_leases + v_idle_leases + v_non_building_jobs) > 0 THEN
    INSERT INTO public.admin_notifications (title, body, category, severity, entity_type)
    VALUES (
      'Hygiene Cleanup Executed',
      format('Cleaned %s orphan leases, %s idle leases, %s non-building jobs',
        v_orphan_leases, v_idle_leases, v_non_building_jobs),
      'ops',
      'info',
      'system'
    );
  END IF;

  RETURN jsonb_build_object(
    'orphan_leases_removed', v_orphan_leases,
    'idle_leases_removed', v_idle_leases,
    'non_building_jobs_failed', v_non_building_jobs,
    'ts', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
