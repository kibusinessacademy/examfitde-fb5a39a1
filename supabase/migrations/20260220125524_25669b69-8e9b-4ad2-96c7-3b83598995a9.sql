
-- Fix: claim_pending_jobs must only pick jobs whose package has a valid lease
-- This prevents the "Jobs ohne Lease-Policy" bug permanently
CREATE OR REPLACE FUNCTION public.claim_pending_jobs(
  p_limit integer DEFAULT 5,
  p_worker_id text DEFAULT 'unknown'::text,
  p_lock_timeout_minutes integer DEFAULT 5
)
RETURNS SETOF job_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Step 1: Release stale locks (processing jobs locked > p_lock_timeout_minutes ago)
  UPDATE public.job_queue
  SET
    status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now(),
    error = format('Stale lock released (locked_by=%s, locked_at=%s)', locked_by, locked_at)
  WHERE status = 'processing'
    AND locked_at IS NOT NULL
    AND locked_at < now() - (p_lock_timeout_minutes || ' minutes')::interval;

  -- Step 2: Also recover "processing but never locked" ghost jobs (> 5 min old)
  UPDATE public.job_queue
  SET
    status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now(),
    error = 'Ghost recovery: processing without lock'
  WHERE status = 'processing'
    AND locked_at IS NULL
    AND updated_at < now() - interval '5 minutes';

  -- Step 3: Claim pending jobs WITH LEASE CHECK
  -- Only pick jobs whose package_id has a valid (non-expired) lease
  RETURN QUERY
  WITH picked AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      -- CRITICAL: Only claim jobs for packages that have an active lease
      AND EXISTS (
        SELECT 1 FROM public.package_leases pl
        WHERE pl.package_id = (jq.payload->>'package_id')::uuid
          AND pl.lease_until > now()
      )
    ORDER BY
      jq.priority DESC,
      jq.run_after ASC NULLS FIRST,
      jq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.job_queue jq
  SET
    status = 'processing',
    started_at = now(),
    locked_at = now(),
    locked_by = p_worker_id,
    updated_at = now(),
    attempts = COALESCE(jq.attempts, 0) + 1
  WHERE jq.id IN (SELECT id FROM picked)
  RETURNING jq.*;
END;
$$;
