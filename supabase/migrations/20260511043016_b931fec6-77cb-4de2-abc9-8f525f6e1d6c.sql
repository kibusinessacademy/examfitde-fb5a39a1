
-- ============================================================================
-- P0: Phantom-Building WIP Deadlock Heal
-- ============================================================================

-- 1) Detection view
CREATE OR REPLACE VIEW public.v_phantom_building_packages AS
SELECT
  cp.id              AS package_id,
  cp.package_key,
  cp.status,
  cp.updated_at      AS package_updated_at,
  COALESCE(cp.feature_flags->'bronze'->>'locked','false')::bool AS bronze_locked,
  (
    SELECT MAX(j.updated_at)
    FROM public.job_queue j
    WHERE j.package_id = cp.id
      AND j.status IN ('processing','queued','pending')
  ) AS last_active_job_at,
  (
    SELECT COUNT(*) FROM public.job_queue j
    WHERE j.package_id = cp.id
      AND j.status IN ('processing','queued','pending')
      AND j.updated_at > now() - interval '6 hours'
  ) AS recent_active_jobs,
  EXISTS (
    SELECT 1 FROM public.pipeline_active_packages pap
    WHERE pap.package_id = cp.id
      AND pap.heartbeat_at > now() - interval '10 minutes'
  ) AS has_live_lease
FROM public.course_packages cp
WHERE cp.status = 'building'
  AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_active_packages pap
    WHERE pap.package_id = cp.id
      AND pap.heartbeat_at > now() - interval '10 minutes'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.job_queue j
    WHERE j.package_id = cp.id
      AND j.status IN ('processing','queued','pending')
      AND j.updated_at > now() - interval '6 hours'
  );

REVOKE ALL ON public.v_phantom_building_packages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_phantom_building_packages TO service_role;

-- 2) Heal RPC (admin-only, status_revert_guard bypass via admin_* prefix)
CREATE OR REPLACE FUNCTION public.admin_heal_phantom_building_packages(
  p_dry_run boolean DEFAULT true,
  p_limit   integer DEFAULT 200
)
RETURNS TABLE (
  package_id uuid,
  package_key text,
  action text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_count  int  := 0;
  v_rec    record;
BEGIN
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  FOR v_rec IN
    SELECT v.package_id, v.package_key, v.bronze_locked, v.last_active_job_at
    FROM public.v_phantom_building_packages v
    ORDER BY v.package_updated_at ASC
    LIMIT p_limit
  LOOP
    -- Skip bronze-locked (handled by separate flow)
    IF v_rec.bronze_locked THEN
      package_id := v_rec.package_id;
      package_key := v_rec.package_key;
      action := 'skip';
      reason := 'bronze_locked';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      package_id := v_rec.package_id;
      package_key := v_rec.package_key;
      action := 'would_demote';
      reason := 'phantom_building_no_lease_no_jobs_6h';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Real demote (admin_* prefix bypasses status-revert-guard)
    UPDATE public.course_packages
       SET status = 'queued',
           updated_at = now()
     WHERE id = v_rec.package_id
       AND status = 'building';

    INSERT INTO public.auto_heal_log(
      action_type, target_type, target_id, result_status, metadata
    ) VALUES (
      'phantom_building_demote',
      'package',
      v_rec.package_id::text,
      'success',
      jsonb_build_object(
        'package_key', v_rec.package_key,
        'last_active_job_at', v_rec.last_active_job_at,
        'reason', 'phantom_building_no_lease_no_jobs_6h',
        'transition', 'building->queued',
        'transition_source', 'admin_heal_phantom_building_packages'
      )
    );

    v_count := v_count + 1;
    package_id := v_rec.package_id;
    package_key := v_rec.package_key;
    action := 'demoted';
    reason := 'phantom_building_no_lease_no_jobs_6h';
    RETURN NEXT;
  END LOOP;

  -- Summary audit row
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES (
    'phantom_building_heal_run',
    'system',
    CASE WHEN v_count > 0 THEN 'success' ELSE 'noop' END,
    jsonb_build_object(
      'demoted_count', v_count,
      'dry_run', p_dry_run,
      'limit', p_limit
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_heal_phantom_building_packages(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_heal_phantom_building_packages(boolean, integer) TO authenticated, service_role;

-- 3) Cron: every 15 minutes
SELECT cron.unschedule('phantom-building-heal-15min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='phantom-building-heal-15min');

SELECT cron.schedule(
  'phantom-building-heal-15min',
  '*/15 * * * *',
  $$ SELECT public.admin_heal_phantom_building_packages(false, 200); $$
);

-- 4) Initial smoke (dry-run) for audit trail
DO $$
DECLARE v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n FROM public.v_phantom_building_packages;
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('phantom_building_heal_install','system','success',
          jsonb_build_object('detected_count', v_n, 'rollout', 'p0_initial'));
END $$;
