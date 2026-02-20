
-- 1) Materialize package_id as real column
ALTER TABLE public.job_queue ADD COLUMN IF NOT EXISTS package_id uuid;

-- 2) Backfill from payload
UPDATE public.job_queue
SET package_id = (payload->>'package_id')::uuid
WHERE package_id IS NULL
  AND payload ? 'package_id';

-- 3) Index for lease-aware queries
CREATE INDEX IF NOT EXISTS idx_job_queue_package_status
ON public.job_queue(package_id, status);

-- 4) Updated claim_pending_jobs using materialized package_id
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
  -- Step 1: Release stale locks
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      error = format('Stale lock released (locked_by=%s, locked_at=%s)', locked_by, locked_at)
  WHERE status = 'processing'
    AND locked_at IS NOT NULL
    AND locked_at < now() - (p_lock_timeout_minutes || ' minutes')::interval;

  -- Step 2: Recover ghost processing jobs (no lock, >5 min)
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      error = 'Ghost recovery: processing without lock'
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
      updated_at = now()
  WHERE jq.id IN (SELECT id FROM picked)
  RETURNING jq.*;
END;
$$;

-- 5) Updated get_building_metrics using materialized package_id
CREATE OR REPLACE FUNCTION public.get_building_metrics()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'active_by_jobs', (
      SELECT count(DISTINCT jq.package_id)
      FROM public.job_queue jq
      WHERE jq.status = 'processing'
        AND jq.package_id IS NOT NULL
    ),
    'active_by_leases', (
      SELECT count(DISTINCT package_id)
      FROM public.package_leases
      WHERE lease_until > now()
    ),
    'status_building', (
      SELECT count(*) FROM public.course_packages WHERE status = 'building'
    ),
    'zombies', (
      SELECT count(*) FROM public.ops_building_without_job_or_lease
    )
  );
$$;
