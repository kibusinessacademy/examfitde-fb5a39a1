-- Drop the OLD overload that causes ambiguity
DROP FUNCTION IF EXISTS public.claim_pending_jobs_v4(integer, text, integer, text);

-- Recreate the NEW one cleanly with CREATE OR REPLACE
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(
  p_worker_id text,
  p_limit integer DEFAULT 5,
  p_lock_timeout_minutes integer DEFAULT 10,
  p_worker_pool text DEFAULT NULL
)
RETURNS SETOF job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _repair_types text[] := ARRAY[
    'package_repair_exam_pool_quality',
    'pool_fill_bloom_gaps',
    'package_repair_minichecks'
  ];
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT jq.id
    FROM job_queue jq
    LEFT JOIN course_packages cp ON cp.id = (jq.payload->>'package_id')::uuid
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
      -- Package-Status-Guard: only claim jobs for building packages (or repair jobs)
      AND (
        cp.id IS NULL                          -- no package ref (system jobs)
        OR cp.status = 'building'              -- normal path
        OR jq.job_type = ANY(_repair_types)    -- repair whitelist
      )
    ORDER BY jq.priority DESC NULLS LAST, jq.created_at ASC
    LIMIT p_limit
    FOR UPDATE OF jq SKIP LOCKED
  )
  UPDATE job_queue q
  SET status = 'processing',
      started_at = now(),
      locked_by = p_worker_id,
      locked_until = now() + (p_lock_timeout_minutes || ' minutes')::interval
  FROM claimable c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$;