
-- 1. SSOT helper
CREATE OR REPLACE FUNCTION public.fn_is_job_type_whitelisted_for_non_building_package(_job_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(can_run_when_not_building, false) OR COALESCE(exempt_from_auto_cancel, false)
     FROM public.job_type_policies WHERE job_type = _job_type),
    false
  );
$$;

-- 2. Add missing policies for SEO infra jobs
INSERT INTO public.job_type_policies (job_type, can_run_when_not_building, exempt_from_auto_cancel, worker_pool, zombie_timeout_minutes, notes)
VALUES
  ('seo_sitemap_refresh', true, true, 'default', 60,
   'SEO infra: sitemap refresh runs on published packages — whitelist required.'),
  ('seo_internal_links',  true, true, 'default', 60,
   'SEO infra: internal-linker runs on published packages — whitelist required.')
ON CONFLICT (job_type) DO UPDATE SET
  can_run_when_not_building = EXCLUDED.can_run_when_not_building,
  exempt_from_auto_cancel   = EXCLUDED.exempt_from_auto_cancel,
  worker_pool               = EXCLUDED.worker_pool,
  notes                     = EXCLUDED.notes,
  updated_at                = now();

-- 3. Patch ops_hygiene_cleanup to honor SSOT whitelist
CREATE OR REPLACE FUNCTION public.ops_hygiene_cleanup(p_max_lease_cleanup integer DEFAULT 100, p_max_job_cleanup integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orphan_leases INT := 0;
  v_non_building_jobs INT := 0;
  v_idle_leases INT := 0;
  v_skipped_whitelisted INT := 0;
BEGIN
  WITH orphan_candidates AS (
    SELECT pl.package_id FROM public.package_leases pl
    WHERE NOT EXISTS (
      SELECT 1 FROM public.course_packages cp
      WHERE cp.id = pl.package_id AND cp.status IN ('building', 'council_review')
    )
    LIMIT p_max_lease_cleanup
  ), deleted AS (
    DELETE FROM public.package_leases pl USING orphan_candidates oc
    WHERE pl.package_id = oc.package_id RETURNING pl.package_id
  )
  SELECT count(*) INTO v_orphan_leases FROM deleted;

  WITH idle_candidates AS (
    SELECT pl.package_id FROM public.package_leases pl
    WHERE NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = pl.package_id AND jq.status IN ('pending', 'processing')
    )
    AND (
      (pl.renewed_at IS NOT NULL AND pl.renewed_at < now() - interval '10 minutes')
      OR (pl.renewed_at IS NULL AND pl.lease_until > now() + interval '20 minutes')
      OR pl.lease_until < now()
    )
    LIMIT p_max_lease_cleanup
  ), idle_deleted AS (
    DELETE FROM public.package_leases pl USING idle_candidates ic
    WHERE pl.package_id = ic.package_id RETURNING pl.package_id
  )
  SELECT count(*) INTO v_idle_leases FROM idle_deleted;

  -- Cancel pending/processing jobs for non-building packages, EXCEPT whitelisted job types
  WITH job_candidates AS (
    SELECT jq.id, jq.job_type
    FROM public.job_queue jq
    JOIN public.course_packages cp ON cp.id = jq.package_id
    WHERE jq.status IN ('pending', 'processing')
      AND jq.package_id IS NOT NULL
      AND cp.status NOT IN ('building', 'council_review', 'blocked', 'quality_gate_failed')
      AND NOT public.fn_is_job_type_whitelisted_for_non_building_package(jq.job_type)
    LIMIT p_max_job_cleanup
  ), cleaned AS (
    UPDATE public.job_queue jq
    SET status = 'failed',
        error = 'OPS_GUARD:NON_BUILDING_PACKAGE',
        last_error = ' | OPS_GUARD:NON_BUILDING_PACKAGE',
        completed_at = now(),
        updated_at = now(),
        locked_at = null,
        locked_by = null,
        meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
          'cancel_source', 'ops_hygiene_cleanup',
          'ops_guard_reason', 'NON_BUILDING_PACKAGE',
          'ops_guard_at', now()
        )
    FROM job_candidates jc
    WHERE jq.id = jc.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_non_building_jobs FROM cleaned;

  -- Count whitelisted survivors for forensics
  SELECT count(*) INTO v_skipped_whitelisted
  FROM public.job_queue jq
  JOIN public.course_packages cp ON cp.id = jq.package_id
  WHERE jq.status IN ('pending', 'processing')
    AND cp.status NOT IN ('building', 'council_review', 'blocked', 'quality_gate_failed')
    AND public.fn_is_job_type_whitelisted_for_non_building_package(jq.job_type);

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail, metadata)
  VALUES (
    'ops_hygiene_cleanup_run', 'ops_hygiene_cleanup', 'system',
    CASE WHEN (v_orphan_leases + v_idle_leases + v_non_building_jobs) > 0 THEN 'applied' ELSE 'noop' END,
    format('Cleaned %s orphan leases, %s idle leases, %s non-building jobs (skipped %s whitelisted)',
      v_orphan_leases, v_idle_leases, v_non_building_jobs, v_skipped_whitelisted),
    jsonb_build_object(
      'orphan_leases_removed', v_orphan_leases,
      'idle_leases_removed', v_idle_leases,
      'non_building_jobs_failed', v_non_building_jobs,
      'whitelisted_skipped', v_skipped_whitelisted
    )
  );

  RETURN jsonb_build_object(
    'orphan_leases_removed', v_orphan_leases,
    'idle_leases_removed', v_idle_leases,
    'non_building_jobs_failed', v_non_building_jobs,
    'whitelisted_skipped', v_skipped_whitelisted
  );
END;
$function$;
