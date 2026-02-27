
-- ============================================================
-- POLISH: Dedupe fix, leases_active_no_work, detail view update
-- ============================================================

-- 1) Better dedupe for LEGACY_RPC_USED: bucket by hour, not exact timestamp
--    Update legacy wrappers to use hour-bucketed details for dedupe
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v2(
  p_limit integer, p_worker_id text, p_lock_timeout_minutes integer
) RETURNS SETOF public.job_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ops_raise_alert('LEGACY_RPC_USED','warn','claim_pending_jobs_v2 called',
    jsonb_build_object('rpc_name','claim_pending_jobs_v2','worker_id',p_worker_id,
      'called_at_bucket', date_trunc('hour',now())::text));
  RETURN QUERY SELECT * FROM public.claim_pending_jobs_v4(p_limit,p_worker_id,p_lock_timeout_minutes);
END; $$;

CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v3(
  p_limit integer, p_worker_id text, p_lock_timeout_minutes integer, p_worker_pool text
) RETURNS SETOF public.job_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ops_raise_alert('LEGACY_RPC_USED','warn','claim_pending_jobs_v3 called',
    jsonb_build_object('rpc_name','claim_pending_jobs_v3','worker_id',p_worker_id,'pool',p_worker_pool,
      'called_at_bucket', date_trunc('hour',now())::text));
  RETURN QUERY SELECT * FROM public.claim_pending_jobs_v4(p_limit,p_worker_id,p_lock_timeout_minutes);
END; $$;

CREATE OR REPLACE FUNCTION public.claim_pending_jobs_current(
  p_limit integer, p_worker_id text, p_lock_timeout_minutes integer
) RETURNS SETOF public.job_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ops_raise_alert('LEGACY_RPC_USED','warn','claim_pending_jobs_current called',
    jsonb_build_object('rpc_name','claim_pending_jobs_current','worker_id',p_worker_id,
      'called_at_bucket', date_trunc('hour',now())::text));
  RETURN QUERY SELECT * FROM public.claim_pending_jobs_v4(p_limit,p_worker_id,p_lock_timeout_minutes);
END; $$;

CREATE OR REPLACE FUNCTION public.claim_pending_jobs(p_limit integer)
RETURNS SETOF public.job_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ops_raise_alert('LEGACY_RPC_USED','warn','claim_pending_jobs(limit) called',
    jsonb_build_object('rpc_name','claim_pending_jobs(int)',
      'called_at_bucket', date_trunc('hour',now())::text));
  RETURN QUERY SELECT * FROM public.claim_pending_jobs_v4(p_limit,'legacy-redirect',30);
END; $$;

CREATE OR REPLACE FUNCTION public.claim_pending_jobs(
  p_limit integer, p_worker_id text, p_lock_timeout_minutes integer
) RETURNS SETOF public.job_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ops_raise_alert('LEGACY_RPC_USED','warn','claim_pending_jobs(limit,worker,timeout) called',
    jsonb_build_object('rpc_name','claim_pending_jobs(int,text,int)','worker_id',p_worker_id,
      'called_at_bucket', date_trunc('hour',now())::text));
  RETURN QUERY SELECT * FROM public.claim_pending_jobs_v4(p_limit,p_worker_id,p_lock_timeout_minutes);
END; $$;

-- 2) Add leases_active_no_work to integrity view
CREATE OR REPLACE VIEW public.ops_runner_integrity AS
SELECT
  now() AS as_of,
  (SELECT count(*)
   FROM public.package_leases pl
   JOIN public.course_packages cp ON cp.id = pl.package_id
   WHERE pl.lease_until > now()
     AND cp.status <> 'building') AS orphan_leases,
  (SELECT count(*)
   FROM public.job_queue jq
   LEFT JOIN public.course_packages cp
     ON cp.id = jq.package_id
     OR cp.id::text = (jq.payload->>'package_id')
   WHERE jq.status = 'pending'
     AND cp.id IS NOT NULL
     AND cp.status <> 'building') AS pending_non_building,
  (SELECT count(*)
   FROM public.job_queue jq
   LEFT JOIN public.course_packages cp
     ON cp.id = jq.package_id
     OR cp.id::text = (jq.payload->>'package_id')
   WHERE jq.status = 'processing'
     AND cp.id IS NOT NULL
     AND cp.status <> 'building') AS processing_non_building,
  (SELECT count(*)
   FROM public.job_queue jq
   WHERE jq.status = 'processing'
     AND jq.started_at IS NOT NULL
     AND jq.started_at < now() - interval '10 minutes') AS stuck_processing_10m,
  (SELECT count(*)
   FROM public.job_queue jq
   WHERE jq.status = 'pending'
     AND (jq.meta->>'artifact_blocked')::boolean IS TRUE
     AND (jq.run_after IS NULL OR jq.run_after <= now())) AS blocked_pending_ready,
  (SELECT count(*)
   FROM public.job_queue jq
   WHERE jq.status IN ('pending','processing')
     AND (jq.package_id IS NOT NULL OR jq.payload->>'package_id' IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM public.course_packages cp
       WHERE cp.id = jq.package_id
          OR cp.id::text = (jq.payload->>'package_id')
     )) AS dangling_jobs_no_package,
  -- NEW: Active leases with no pending/processing work
  (SELECT count(*)
   FROM public.package_leases pl
   JOIN public.course_packages cp ON cp.id = pl.package_id
   WHERE pl.lease_until > now()
     AND cp.status = 'building'
     AND NOT EXISTS (
       SELECT 1 FROM public.job_queue jq
       WHERE jq.status IN ('pending','processing')
         AND (jq.package_id = pl.package_id
           OR (jq.payload->>'package_id') = pl.package_id::text)
     )) AS leases_active_no_work;

-- 3) Update integrity check to include leases_active_no_work
CREATE OR REPLACE FUNCTION public.ops_run_integrity_checks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v record;
  v_hollow_cnt int;
BEGIN
  SELECT * INTO v FROM public.ops_runner_integrity;
  SELECT count(*) INTO v_hollow_cnt FROM public.ops_hollow_completions;

  IF coalesce(v.orphan_leases,0) > 0 THEN
    PERFORM public.ops_raise_alert('ORPHAN_LEASES_NON_BUILDING','critical',
      'Orphan leases for non-building packages', jsonb_build_object('count',v.orphan_leases));
  END IF;
  IF coalesce(v.pending_non_building,0) > 0 THEN
    PERFORM public.ops_raise_alert('PENDING_JOBS_NON_BUILDING','warn',
      'Pending jobs for non-building packages', jsonb_build_object('count',v.pending_non_building));
  END IF;
  IF coalesce(v.processing_non_building,0) > 0 THEN
    PERFORM public.ops_raise_alert('PROCESSING_JOBS_NON_BUILDING','critical',
      'Processing jobs for non-building packages', jsonb_build_object('count',v.processing_non_building));
  END IF;
  IF coalesce(v.stuck_processing_10m,0) > 0 THEN
    PERFORM public.ops_raise_alert('STUCK_PROCESSING_JOBS_10M','warn',
      'Jobs stuck processing >10min', jsonb_build_object('count',v.stuck_processing_10m));
  END IF;
  IF coalesce(v.blocked_pending_ready,0) > 0 THEN
    PERFORM public.ops_raise_alert('BLOCKED_PENDING_READY','info',
      'Blocked pending jobs ready', jsonb_build_object('count',v.blocked_pending_ready));
  END IF;
  IF v_hollow_cnt > 0 THEN
    PERFORM public.ops_raise_alert('HOLLOW_COMPLETION_EXAM_POOL','critical',
      'Step done but 0 artifacts', jsonb_build_object('count',v_hollow_cnt));
  END IF;
  IF coalesce(v.dangling_jobs_no_package,0) > 0 THEN
    PERFORM public.ops_raise_alert('DANGLING_JOBS_NO_PACKAGE','warn',
      'Jobs reference non-existent packages', jsonb_build_object('count',v.dangling_jobs_no_package));
  END IF;
  IF coalesce(v.leases_active_no_work,0) > 0 THEN
    PERFORM public.ops_raise_alert('LEASES_ACTIVE_NO_WORK','info',
      'Active leases for building packages with no pending/processing jobs',
      jsonb_build_object('count',v.leases_active_no_work));
  END IF;

  RETURN jsonb_build_object('ok',true,'snapshot', jsonb_build_object(
    'orphan_leases', coalesce(v.orphan_leases,0),
    'pending_non_building', coalesce(v.pending_non_building,0),
    'processing_non_building', coalesce(v.processing_non_building,0),
    'stuck_processing_10m', coalesce(v.stuck_processing_10m,0),
    'blocked_pending_ready', coalesce(v.blocked_pending_ready,0),
    'hollow_completion_exam_pool', v_hollow_cnt,
    'dangling_jobs_no_package', coalesce(v.dangling_jobs_no_package,0),
    'leases_active_no_work', coalesce(v.leases_active_no_work,0)
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.ops_run_integrity_checks() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_run_integrity_checks() TO service_role;

-- 4) Update detail view with leases_active_no_work category
CREATE OR REPLACE VIEW public.ops_runner_integrity_details AS
SELECT 'orphan_leases'::text AS category, pl.package_id::text AS ref_id,
  cp.status AS package_status, pl.lease_until AS ts, pl.runner_id AS info
FROM public.package_leases pl
JOIN public.course_packages cp ON cp.id = pl.package_id
WHERE pl.lease_until > now() AND cp.status <> 'building'
UNION ALL
SELECT 'pending_non_building', coalesce(jq.package_id::text, jq.payload->>'package_id'),
  cp.status, jq.updated_at, jq.job_type
FROM public.job_queue jq
LEFT JOIN public.course_packages cp ON cp.id = jq.package_id OR cp.id::text = (jq.payload->>'package_id')
WHERE jq.status = 'pending' AND cp.id IS NOT NULL AND cp.status <> 'building'
UNION ALL
SELECT 'dangling_jobs_no_package', coalesce(jq.package_id::text, jq.payload->>'package_id'),
  null, jq.updated_at, jq.job_type
FROM public.job_queue jq
WHERE jq.status IN ('pending','processing')
  AND (jq.package_id IS NOT NULL OR jq.payload->>'package_id' IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.course_packages cp
    WHERE cp.id = jq.package_id OR cp.id::text = (jq.payload->>'package_id')
  )
UNION ALL
SELECT 'leases_active_no_work', pl.package_id::text,
  cp.status, pl.lease_until, pl.runner_id
FROM public.package_leases pl
JOIN public.course_packages cp ON cp.id = pl.package_id
WHERE pl.lease_until > now()
  AND cp.status = 'building'
  AND NOT EXISTS (
    SELECT 1 FROM public.job_queue jq
    WHERE jq.status IN ('pending','processing')
      AND (jq.package_id = pl.package_id
        OR (jq.payload->>'package_id') = pl.package_id::text)
  );
