
-- ═══════════════════════════════════════════════════════════════
-- SPEED & STABILITY OPTIMIZATION: Lease durations + orphan recovery
-- ═══════════════════════════════════════════════════════════════

-- 1) claim_pending_jobs_v4: Reduce auto-heal lease from 30 min → 5 min
--    Root cause of starvation: crashed content-runners leave 30-min leases
--    that block orphan recovery for the entire duration.
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(
  p_limit integer DEFAULT 5,
  p_worker_id text DEFAULT 'anonymous'::text,
  p_lock_timeout_minutes integer DEFAULT 10,
  p_worker_pool text DEFAULT NULL::text
)
RETURNS SETOF job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- 1. Stale lock recovery
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = format('Stale lock released (locked_by=%s, locked_at=%s)', locked_by, locked_at)
  WHERE status = 'processing'
    AND locked_at IS NOT NULL
    AND locked_at < now() - (p_lock_timeout_minutes || ' minutes')::interval
    AND (p_worker_pool IS NULL OR worker_pool = p_worker_pool);

  -- 2. Ghost recovery
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = 'Ghost recovery: processing without lock'
  WHERE status = 'processing'
    AND locked_at IS NULL
    AND updated_at < now() - interval '5 minutes'
    AND (p_worker_pool IS NULL OR worker_pool = p_worker_pool);

  -- 3. AUTO-LEASE HEALING: Create temporary leases for orphaned package-bound jobs
  --    OPTIMIZED: 30 min → 5 min lease to prevent starvation from crashed runners
  INSERT INTO public.package_leases (package_id, runner_id, acquired_at, lease_until, renewed_at)
  SELECT DISTINCT jq.package_id,
         'auto-heal-' || p_worker_id,
         now(),
         now() + interval '5 minutes',
         now()
  FROM public.job_queue jq
  JOIN public.course_packages cp ON cp.id = jq.package_id
  WHERE jq.status = 'pending'
    AND jq.package_id IS NOT NULL
    AND (jq.run_after IS NULL OR jq.run_after <= now())
    AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
    AND cp.status = 'building'
    AND NOT EXISTS (
      SELECT 1 FROM public.package_leases pl
      WHERE pl.package_id = jq.package_id
        AND pl.lease_until > now()
    )
  ON CONFLICT (package_id) DO UPDATE
    SET lease_until = GREATEST(package_leases.lease_until, now() + interval '5 minutes'),
        renewed_at = now(),
        runner_id = 'auto-heal-' || p_worker_id;

  -- 4. Claim jobs
  RETURN QUERY
  WITH picked AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
      AND (
        jq.package_id IS NULL
        OR
        EXISTS (
          SELECT 1 FROM public.package_leases pl
          WHERE pl.package_id = jq.package_id
            AND pl.lease_until > now()
        )
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
$function$;

-- 2) acquire_next_package_lease (v1): Reduce default from 600s → 180s
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease(
  p_runner_id text,
  p_lease_seconds integer DEFAULT 180
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_package_id uuid;
  v_max_slots int;
  v_active_leases int;
  v_building_count int;
  v_wip_limit int := 5;
  v_top30_incomplete int;
  v_effective_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(42424242);

  SELECT coalesce((SELECT (value #>> '{}')::int FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages'), 5)
  INTO v_max_slots;

  DELETE FROM public.package_leases WHERE lease_until < now();

  SELECT count(*) INTO v_active_leases FROM public.package_leases WHERE lease_until > now();
  IF v_active_leases >= v_max_slots THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_building_count FROM public.course_packages WHERE status = 'building';

  SELECT count(*) INTO v_top30_incomplete
  FROM public.course_packages
  WHERE priority <= 10 AND status NOT IN ('published', 'done', 'blocked');

  SELECT cp.id INTO v_package_id
  FROM public.course_packages cp
  WHERE (
      (cp.status = 'building' AND NOT EXISTS (
         SELECT 1 FROM public.package_leases pl WHERE pl.package_id = cp.id AND pl.lease_until > now()
      ))
      OR (cp.status IN ('queued','failed') AND v_building_count < v_wip_limit)
  )
    AND (v_top30_incomplete = 0 OR cp.priority <= 10)
  ORDER BY
    CASE WHEN cp.status = 'building' THEN 0 WHEN cp.status = 'queued' THEN 1 WHEN cp.status = 'failed' THEN 2 ELSE 3 END,
    cp.priority ASC NULLS LAST,
    cp.queue_position ASC NULLS LAST,
    cp.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_package_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.course_packages
  SET status = 'building', last_error = NULL
  WHERE id = v_package_id AND status IN ('queued','failed');

  SELECT status INTO v_effective_status FROM public.course_packages WHERE id = v_package_id;
  IF v_effective_status <> 'building' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.package_leases (package_id, runner_id, lease_until)
  VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
  ON CONFLICT (package_id) DO UPDATE
  SET runner_id = p_runner_id,
      lease_until = now() + (p_lease_seconds || ' seconds')::interval;

  RETURN v_package_id;
END;
$function$;

-- 3) Reduce orphan reclaim threshold from 3 min → 90 sec in acquire_v2
--    This requires recreating acquire_next_package_lease_v2
--    (Only changing the interval '3 minutes' to '90 seconds')
