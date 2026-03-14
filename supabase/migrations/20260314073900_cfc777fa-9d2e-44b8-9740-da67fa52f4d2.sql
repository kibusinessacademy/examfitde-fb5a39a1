-- =====================================================
-- SYSTEMWIDE FIX: OPS_GUARD deadlock for non-building packages
-- 
-- ROOT CAUSE: ops_cancel_pending_non_building_jobs kills ALL pending jobs
-- for packages not in 'building' status. But when a package reaches
-- 'quality_gate_failed', it needs run_integrity_check to re-run to
-- change its status — creating an irrecoverable deadlock.
--
-- FIX: Exclude 'quality_gate_failed' and 'blocked' from the guard,
-- allowing recovery jobs to execute.
-- =====================================================

-- 1. Fix the OPS_GUARD function to allow recovery
CREATE OR REPLACE FUNCTION public.ops_cancel_pending_non_building_jobs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  WITH picked AS (
    SELECT jq.id
    FROM public.job_queue jq
    JOIN public.course_packages cp
      ON cp.id = jq.package_id OR cp.id::text = (jq.payload->>'package_id')
    WHERE jq.status = 'pending'
      -- Allow building, quality_gate_failed, and blocked packages to run jobs
      -- quality_gate_failed needs run_integrity_check to recover
      -- blocked may need heal jobs to unblock
      AND cp.status NOT IN ('building', 'quality_gate_failed', 'blocked')
    LIMIT 500
  )
  UPDATE public.job_queue jq
  SET status = 'failed',
      updated_at = now(),
      last_error = coalesce(jq.last_error,'') || ' | OPS_GUARD:NON_BUILDING_PACKAGE',
      meta = coalesce(jq.meta,'{}'::jsonb) || jsonb_build_object(
        'ops_guard', true,
        'ops_guard_reason', 'NON_BUILDING_PACKAGE',
        'ops_guard_at', now()
      )
  FROM picked
  WHERE jq.id = picked.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    PERFORM public.ops_raise_alert(
      'NON_BUILDING_PENDING_CLEANUP',
      CASE WHEN v_count >= 10 THEN 'warn' ELSE 'info' END,
      format('Auto-failed %s pending jobs on non-building packages', v_count),
      jsonb_build_object(
        'count', v_count,
        'cleaned_at_bucket', date_trunc('hour', now())
      )
    );
  END IF;

  RETURN v_count;
END;
$function$;

-- 2. Reset Industriemechaniker to building so pipeline can continue
UPDATE course_packages
SET status = 'building'
WHERE id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
AND status = 'quality_gate_failed';

-- 3. Reset run_integrity_check step (was failed by OPS_GUARD)
UPDATE package_steps
SET status = 'queued',
    last_error = NULL,
    job_id = NULL,
    runner_id = NULL,
    started_at = NULL,
    attempts = 0
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
AND step_key = 'run_integrity_check';

-- 4. SYSTEMWIDE: Fix ALL packages stuck in quality_gate_failed with queued steps
UPDATE course_packages
SET status = 'building'
WHERE status = 'quality_gate_failed'
AND EXISTS (
  SELECT 1 FROM package_steps ps 
  WHERE ps.package_id = course_packages.id 
  AND ps.status = 'queued'
  AND ps.step_key IN ('run_integrity_check', 'quality_council', 'auto_publish')
);

-- 5. SYSTEMWIDE: Reset run_integrity_check steps that were killed by OPS_GUARD
UPDATE package_steps ps
SET status = 'queued',
    last_error = NULL,
    job_id = NULL,
    runner_id = NULL,
    started_at = NULL,
    attempts = 0
FROM course_packages cp
WHERE ps.package_id = cp.id
AND cp.status = 'building'
AND ps.step_key = 'run_integrity_check'
AND ps.status = 'queued'
AND ps.last_error LIKE '%OPS_GUARD%';