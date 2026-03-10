
-- ============================================================
-- P0: Job Liveness Guard SSOT
-- ============================================================

-- 1) New columns for liveness tracking
ALTER TABLE public.job_queue
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS liveness_status text NOT NULL DEFAULT 'healthy';

-- Backfill existing rows
UPDATE public.job_queue
SET last_heartbeat_at = COALESCE(last_heartbeat_at, updated_at, started_at, locked_at)
WHERE last_heartbeat_at IS NULL;

-- Index for efficient stale-processing queries
CREATE INDEX IF NOT EXISTS idx_job_queue_processing_liveness
  ON public.job_queue (status, worker_pool, last_heartbeat_at);

CREATE INDEX IF NOT EXISTS idx_job_queue_package_status
  ON public.job_queue (package_id, status, updated_at);

-- Constraint for valid liveness_status values
ALTER TABLE public.job_queue
  DROP CONSTRAINT IF EXISTS job_queue_liveness_status_chk;

ALTER TABLE public.job_queue
  ADD CONSTRAINT job_queue_liveness_status_chk
  CHECK (liveness_status IN ('healthy','suspect','killed','cooldown_exhausted'));

-- ============================================================
-- 2) Heartbeat RPC — content-runner calls this every 20s
-- ============================================================
CREATE OR REPLACE FUNCTION public.heartbeat_job_processing(
  p_job_id uuid,
  p_worker_id text,
  p_provider text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.job_queue
  SET
    last_heartbeat_at = now(),
    updated_at = now(),
    locked_by = COALESCE(locked_by, p_worker_id),
    meta = COALESCE(meta, '{}'::jsonb)
      || jsonb_build_object(
           'last_worker_id', p_worker_id,
           'last_provider', p_provider,
           'last_model', p_model,
           'last_heartbeat_source', 'content-runner'
         )
      || COALESCE(p_meta, '{}'::jsonb)
  WHERE id = p_job_id
    AND status = 'processing';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.heartbeat_job_processing(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_job_processing(uuid, text, text, text, jsonb) TO service_role;

-- ============================================================
-- 3) Kill stale processing jobs (heartbeat-based)
-- ============================================================
CREATE OR REPLACE FUNCTION public.kill_stale_processing_jobs_v2(
  p_heartbeat_timeout_seconds integer DEFAULT 600,
  p_package_id uuid DEFAULT NULL,
  p_worker_pool text DEFAULT NULL,
  p_reason text DEFAULT 'JOB_LIVENESS_GUARD',
  p_requeue boolean DEFAULT true
)
RETURNS TABLE(
  job_id uuid,
  package_id uuid,
  job_type text,
  old_status text,
  new_status text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT jq.id, jq.package_id, jq.job_type, jq.status
    FROM public.job_queue jq
    WHERE jq.status = 'processing'
      AND (p_package_id IS NULL OR jq.package_id = p_package_id)
      AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
      AND COALESCE(jq.last_heartbeat_at, jq.updated_at, jq.locked_at, jq.started_at)
            < now() - make_interval(secs => p_heartbeat_timeout_seconds)
  ),
  upd AS (
    UPDATE public.job_queue jq
    SET
      status = CASE WHEN p_requeue THEN 'pending' ELSE 'cancelled' END,
      liveness_status = 'killed',
      locked_at = NULL,
      locked_by = NULL,
      run_after = CASE
        WHEN p_requeue THEN now() + interval '20 seconds'
        ELSE jq.run_after
      END,
      completed_at = CASE
        WHEN p_requeue THEN jq.completed_at
        ELSE now()
      END,
      last_error = left(COALESCE(jq.last_error, '') || ' | ' || p_reason, 1000),
      last_error_code = 'JOB_LIVENESS_GUARD',
      updated_at = now(),
      meta = COALESCE(jq.meta, '{}'::jsonb)
        || jsonb_build_object(
             'liveness_killed_at', now(),
             'liveness_kill_reason', p_reason,
             'liveness_prev_status', jq.status,
             'liveness_requeued', p_requeue
           )
    FROM candidates c
    WHERE jq.id = c.id
    RETURNING jq.id, jq.package_id, jq.job_type, c.status,
              CASE WHEN p_requeue THEN 'pending'::text ELSE 'cancelled'::text END,
              p_reason
  )
  SELECT * FROM upd;
END;
$$;

REVOKE ALL ON FUNCTION public.kill_stale_processing_jobs_v2(integer, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kill_stale_processing_jobs_v2(integer, uuid, text, text, boolean) TO service_role;

-- ============================================================
-- 4) Release lease when package has no alive processing work
-- ============================================================
CREATE OR REPLACE FUNCTION public.release_stale_package_lease_v2(
  p_package_id uuid,
  p_reason text DEFAULT 'LEASE_NO_PROGRESS'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_alive_work boolean;
  v_deleted boolean := false;
BEGIN
  -- Check if any alive work exists (pending jobs or recently-heartbeated processing jobs)
  SELECT EXISTS (
    SELECT 1
    FROM public.job_queue jq
    WHERE jq.package_id = p_package_id
      AND jq.status IN ('pending','processing')
      AND (
        jq.status = 'pending'
        OR COALESCE(jq.last_heartbeat_at, jq.updated_at, jq.locked_at, jq.started_at) > now() - interval '10 minutes'
      )
  ) INTO v_has_alive_work;

  IF v_has_alive_work THEN
    RETURN false;
  END IF;

  -- Release the lease
  DELETE FROM public.package_leases
  WHERE package_id = p_package_id
    AND lease_until > now();

  v_deleted := FOUND;

  -- Reset any running/enqueued/processing steps back to queued
  UPDATE public.package_steps
  SET
    status = CASE WHEN status IN ('running','enqueued','processing') THEN 'queued' ELSE status END,
    job_id = NULL,
    runner_id = NULL,
    started_at = NULL,
    last_error = left(COALESCE(last_error, '') || ' | ' || p_reason, 1000),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'lease_released_by_liveness', true,
      'lease_released_at', now(),
      'lease_release_reason', p_reason
    )
  WHERE package_id = p_package_id
    AND status IN ('running','enqueued','processing');

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.release_stale_package_lease_v2(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_stale_package_lease_v2(uuid, text) TO service_role;
