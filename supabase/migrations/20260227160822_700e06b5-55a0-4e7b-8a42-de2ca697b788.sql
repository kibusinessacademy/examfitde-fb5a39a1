
-- ============================================================
-- FINISH LINE: Legacy Wrapper + Telemetry, Cron Cleanup, Detail View
-- ============================================================

-- 1) Disable orphan lease expire cron (trigger makes it obsolete)
SELECT cron.unschedule('ops_expire_orphan_leases_15m');

-- 2) Drop + recreate legacy RPCs as thin wrappers with telemetry
DROP FUNCTION IF EXISTS public.claim_pending_jobs_v2(integer, text, integer);
DROP FUNCTION IF EXISTS public.claim_pending_jobs_v3(integer, text, integer, text);
DROP FUNCTION IF EXISTS public.claim_pending_jobs_current(integer, text, integer);
DROP FUNCTION IF EXISTS public.claim_pending_jobs(integer);
DROP FUNCTION IF EXISTS public.claim_pending_jobs(integer, text, integer);

CREATE FUNCTION public.claim_pending_jobs_v2(
  p_limit integer, p_worker_id text, p_lock_timeout_minutes integer
) RETURNS SETOF public.job_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ops_raise_alert('LEGACY_RPC_USED','warn','claim_pending_jobs_v2 called',
    jsonb_build_object('worker_id',p_worker_id,'called_at',now()::text));
  RETURN QUERY SELECT * FROM public.claim_pending_jobs_v4(p_limit,p_worker_id,p_lock_timeout_minutes);
END; $$;

CREATE FUNCTION public.claim_pending_jobs_v3(
  p_limit integer, p_worker_id text, p_lock_timeout_minutes integer, p_worker_pool text
) RETURNS SETOF public.job_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ops_raise_alert('LEGACY_RPC_USED','warn','claim_pending_jobs_v3 called',
    jsonb_build_object('worker_id',p_worker_id,'pool',p_worker_pool,'called_at',now()::text));
  RETURN QUERY SELECT * FROM public.claim_pending_jobs_v4(p_limit,p_worker_id,p_lock_timeout_minutes);
END; $$;

CREATE FUNCTION public.claim_pending_jobs_current(
  p_limit integer, p_worker_id text, p_lock_timeout_minutes integer
) RETURNS SETOF public.job_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ops_raise_alert('LEGACY_RPC_USED','warn','claim_pending_jobs_current called',
    jsonb_build_object('worker_id',p_worker_id,'called_at',now()::text));
  RETURN QUERY SELECT * FROM public.claim_pending_jobs_v4(p_limit,p_worker_id,p_lock_timeout_minutes);
END; $$;

CREATE FUNCTION public.claim_pending_jobs(p_limit integer)
RETURNS SETOF public.job_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ops_raise_alert('LEGACY_RPC_USED','warn','claim_pending_jobs(limit) called',
    jsonb_build_object('called_at',now()::text));
  RETURN QUERY SELECT * FROM public.claim_pending_jobs_v4(p_limit,'legacy-redirect',30);
END; $$;

CREATE FUNCTION public.claim_pending_jobs(
  p_limit integer, p_worker_id text, p_lock_timeout_minutes integer
) RETURNS SETOF public.job_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ops_raise_alert('LEGACY_RPC_USED','warn','claim_pending_jobs(limit,worker,timeout) called',
    jsonb_build_object('worker_id',p_worker_id,'called_at',now()::text));
  RETURN QUERY SELECT * FROM public.claim_pending_jobs_v4(p_limit,p_worker_id,p_lock_timeout_minutes);
END; $$;

-- Grant only service_role
GRANT EXECUTE ON FUNCTION public.claim_pending_jobs_v2(integer,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pending_jobs_v3(integer,text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pending_jobs_current(integer,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pending_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pending_jobs(integer,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_pending_jobs_v2(integer,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_pending_jobs_v3(integer,text,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_pending_jobs_current(integer,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_pending_jobs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_pending_jobs(integer,text,integer) FROM PUBLIC, anon, authenticated;

-- 3) Standardize trigger error prefix
CREATE OR REPLACE FUNCTION public.guard_package_leases_building_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.course_packages WHERE id = NEW.package_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'OPS_GUARD:PACKAGE_LEASES_NOT_FOUND: package_id=% not in course_packages', NEW.package_id;
  END IF;
  IF v_status <> 'building' THEN
    RAISE EXCEPTION 'OPS_GUARD:PACKAGE_LEASES_NON_BUILDING: package_id=% status=%', NEW.package_id, v_status;
  END IF;
  RETURN NEW;
END; $$;

-- 4) Detail view for quick debugging
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
  );
