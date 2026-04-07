
-- Fix overload 1: (p_worker_id, p_limit, p_worker_pool)
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(p_worker_id text, p_limit integer DEFAULT 5, p_worker_pool text DEFAULT NULL::text)
 RETURNS SETOF job_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH claimable_raw AS (
    SELECT jq.id, jq.job_type
    FROM job_queue jq
    LEFT JOIN course_packages cp ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN job_type_policies jtp ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (
        CASE
          WHEN p_worker_pool IS NOT NULL THEN
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = p_worker_pool
          ELSE
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = 'default'
        END
      )
      AND (
        cp.id IS NULL
        OR cp.status = 'building'
        OR COALESCE(jtp.can_run_when_not_building, false)
      )
    ORDER BY jq.priority ASC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE job_queue q
  SET status = 'processing',
      started_at = now(),
      locked_by = p_worker_id,
      locked_at = now()
  FROM claimable_raw c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$function$;

-- Fix overload 2: (p_worker_id, p_limit, p_lock_timeout_minutes, p_worker_pool)
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(p_worker_id text, p_limit integer DEFAULT 5, p_lock_timeout_minutes integer DEFAULT 30, p_worker_pool text DEFAULT NULL::text)
 RETURNS SETOF job_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH claimable_raw AS (
    SELECT jq.id, jq.job_type
    FROM public.job_queue jq
    LEFT JOIN public.course_packages cp
      ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN public.job_type_policies jtp
      ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (
        CASE
          WHEN p_worker_pool IS NOT NULL THEN
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = p_worker_pool
          ELSE
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = 'default'
        END
      )
      AND (
        cp.id IS NULL
        OR cp.status = 'building'
        OR COALESCE(jtp.can_run_when_not_building, false)
      )
    ORDER BY jq.priority ASC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.job_queue q
  SET status = 'processing',
      started_at = now(),
      locked_by = p_worker_id,
      locked_at = now()
  FROM claimable_raw c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$function$;
