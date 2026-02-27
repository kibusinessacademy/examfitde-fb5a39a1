-- Add worker pool sharding to job_queue
ALTER TABLE public.job_queue
ADD COLUMN IF NOT EXISTS worker_pool text NOT NULL DEFAULT 'core';

-- Index for leasing / scanning by pool
CREATE INDEX IF NOT EXISTS job_queue_worker_pool_status_updated_idx
ON public.job_queue (worker_pool, status, updated_at);

-- Backfill existing heavy jobs to content pool
UPDATE public.job_queue
SET worker_pool = 'content'
WHERE worker_pool = 'core'
  AND job_type IN (
    'package_generate_learning_content',
    'package_generate_handbook',
    'package_generate_glossary',
    'mass_enrich_competencies_v2',
    'package_generate_lesson_minichecks',
    'package_generate_oral_exam'
  );

-- Create claim_pending_jobs_v3 with worker_pool filter
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v3(
  p_limit integer,
  p_worker_id text DEFAULT 'legacy_v1',
  p_lock_timeout_minutes integer DEFAULT 10,
  p_worker_pool text DEFAULT NULL
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Stale lock recovery (same as v2)
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = format('Stale lock released (locked_by=%s, locked_at=%s)', locked_by, locked_at)
  WHERE status = 'processing'
    AND locked_at IS NOT NULL
    AND locked_at < now() - (p_lock_timeout_minutes || ' minutes')::interval
    AND (p_worker_pool IS NULL OR worker_pool = p_worker_pool);

  -- Ghost recovery (same as v2)
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = 'Ghost recovery: processing without lock'
  WHERE status = 'processing'
    AND locked_at IS NULL
    AND updated_at < now() - interval '5 minutes'
    AND (p_worker_pool IS NULL OR worker_pool = p_worker_pool);

  -- Claim with lease guard + pool filter
  RETURN QUERY
  WITH picked AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND jq.package_id IS NOT NULL
      AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
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
      started_at = now(),
      updated_at = now()
  WHERE jq.id IN (SELECT id FROM picked)
  RETURNING jq.*;
END;
$$;