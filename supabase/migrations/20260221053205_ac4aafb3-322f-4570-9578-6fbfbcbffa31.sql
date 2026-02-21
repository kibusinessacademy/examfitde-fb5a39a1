
-- =====================================================
-- FIX: claim_pending_jobs must set started_at when claiming
-- ROOT CAUSE: Jobs go to 'processing' without started_at being set
-- This creates zombie jobs that get re-locked indefinitely 
-- because the runner expects started_at to indicate execution began
-- =====================================================
CREATE OR REPLACE FUNCTION public.claim_pending_jobs(
  p_limit integer DEFAULT 5,
  p_worker_id text DEFAULT 'unknown'::text,
  p_lock_timeout_minutes integer DEFAULT 5
)
RETURNS SETOF job_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Step 1: Release stale locks
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = format('Stale lock released (locked_by=%s, locked_at=%s)', locked_by, locked_at)
  WHERE status = 'processing'
    AND locked_at IS NOT NULL
    AND locked_at < now() - (p_lock_timeout_minutes || ' minutes')::interval;

  -- Step 2: Recover ghost processing jobs (no lock, >5 min)
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = 'Ghost recovery: processing without lock'
  WHERE status = 'processing'
    AND locked_at IS NULL
    AND updated_at < now() - interval '5 minutes';

  -- Step 3: Claim with LEASE GUARD on materialized package_id
  RETURN QUERY
  WITH picked AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND jq.package_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.package_leases pl
        WHERE pl.package_id = jq.package_id
          AND pl.lease_until > now()
      )
    ORDER BY jq.priority DESC, jq.run_after ASC NULLS FIRST, jq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.job_queue jq
  SET status = 'processing',
      locked_at = now(),
      locked_by = p_worker_id,
      started_at = now(),          -- ← FIX: was MISSING
      updated_at = now()
  WHERE jq.id IN (SELECT id FROM picked)
  RETURNING jq.*;
END;
$function$;

-- Also fix current zombie jobs
UPDATE public.job_queue
SET started_at = locked_at
WHERE status = 'processing' AND started_at IS NULL AND locked_at IS NOT NULL;
