
-- ============================================================
-- NIGHTLY AUTO-HEALER: Reset STALE_LOCK failures automatically
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_nightly_auto_heal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_steps_healed int := 0;
  v_jobs_healed int := 0;
  v_ghosts_cleared int := 0;
BEGIN
  -- 1. Reset failed steps with STALE_LOCK errors back to queued
  WITH healed AS (
    UPDATE package_steps ps
    SET 
      status = 'queued',
      started_at = NULL,
      finished_at = NULL,
      last_error = NULL,
      meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
        'auto_healed_at', now()::text,
        'auto_healed_from', ps.last_error,
        'heal_source', 'nightly_auto_heal'
      )
    FROM course_packages cp
    WHERE ps.package_id = cp.id
      AND cp.status = 'building'
      AND ps.status = 'failed'
      AND (
        ps.last_error ILIKE '%STALE_LOCK%'
        OR ps.last_error ILIKE '%hot-loop%'
        OR ps.last_error ILIKE '%ZOMBIE_TERMINAL%'
      )
    RETURNING ps.id
  )
  SELECT count(*) INTO v_steps_healed FROM healed;

  -- 2. Reset failed jobs with stale lock errors
  WITH healed_jobs AS (
    DELETE FROM job_queue jq
    USING course_packages cp
    WHERE jq.package_id = cp.id
      AND cp.status = 'building'
      AND jq.status = 'failed'
      AND (
        jq.last_error ILIKE '%STALE_LOCK%'
        OR jq.last_error ILIKE '%hot-loop%'
        OR jq.last_error ILIKE '%ZOMBIE_TERMINAL%'
      )
    RETURNING jq.id
  )
  SELECT count(*) INTO v_jobs_healed FROM healed_jobs;

  -- 3. Clear ghost timestamps on stale queued steps
  WITH ghosts AS (
    UPDATE package_steps ps
    SET 
      started_at = NULL,
      finished_at = NULL,
      last_error = NULL
    FROM course_packages cp
    WHERE ps.package_id = cp.id
      AND cp.status = 'building'
      AND ps.status = 'queued'
      AND ps.started_at IS NOT NULL
      AND ps.started_at < now() - interval '24 hours'
    RETURNING ps.id
  )
  SELECT count(*) INTO v_ghosts_cleared FROM ghosts;

  -- 4. Reset stuck enqueued steps
  UPDATE package_steps ps
  SET status = 'queued', started_at = NULL, finished_at = NULL
  FROM course_packages cp
  WHERE ps.package_id = cp.id
    AND cp.status = 'building'
    AND ps.status = 'enqueued'
    AND ps.started_at < now() - interval '2 hours';

  RETURN jsonb_build_object(
    'ok', true,
    'steps_healed', v_steps_healed,
    'jobs_healed', v_jobs_healed,
    'ghosts_cleared', v_ghosts_cleared,
    'healed_at', now()::text
  );
END;
$$;
