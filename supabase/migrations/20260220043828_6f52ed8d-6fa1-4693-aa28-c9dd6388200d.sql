-- Fix claim_pending_jobs: set locked_at/locked_by + stale lock recovery
CREATE OR REPLACE FUNCTION public.claim_pending_jobs(
  p_limit integer DEFAULT 10,
  p_worker_id text DEFAULT 'job-runner',
  p_lock_timeout_minutes integer DEFAULT 10
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Step 3: Claim pending jobs with proper locking
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.job_queue
    WHERE status = 'pending'
      AND (run_after IS NULL OR run_after <= now())
    ORDER BY
      priority DESC,
      run_after ASC NULLS FIRST,
      created_at ASC
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