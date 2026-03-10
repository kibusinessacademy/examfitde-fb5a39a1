
-- ============================================================
-- P0 Hardening: Liveness indexes + race-safe lease release
-- ============================================================

-- 1) Partial indexes for liveness queries (stuck-scan, content-runner)
CREATE INDEX IF NOT EXISTS idx_job_queue_processing_heartbeat
  ON public.job_queue (last_heartbeat_at, updated_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_job_queue_pkg_status_heartbeat
  ON public.job_queue (package_id, status, last_heartbeat_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_job_queue_liveness_status
  ON public.job_queue (liveness_status)
  WHERE liveness_status != 'healthy';

-- 2) Fix race condition in release_stale_package_lease_v2:
--    Only reset steps that have NO alive job_id owner remaining
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

  -- Race-safe step reset: only reset steps whose job_id no longer has
  -- an alive owner in job_queue. This prevents resetting a step that
  -- was already re-claimed by a new runner.
  UPDATE public.package_steps ps
  SET
    status = 'queued',
    job_id = NULL,
    runner_id = NULL,
    started_at = NULL,
    last_error = left(COALESCE(ps.last_error, '') || ' | ' || p_reason, 1000),
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'lease_released_by_liveness', true,
      'lease_released_at', now(),
      'lease_release_reason', p_reason
    )
  WHERE ps.package_id = p_package_id
    AND ps.status IN ('running','enqueued','processing')
    AND NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.id = ps.job_id
        AND jq.status IN ('pending','processing')
        AND COALESCE(jq.last_heartbeat_at, jq.updated_at) > now() - interval '10 minutes'
    );

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.release_stale_package_lease_v2(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_stale_package_lease_v2(uuid, text) TO service_role;
