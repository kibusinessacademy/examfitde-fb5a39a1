
-- ═══════════════════════════════════════════════════════════════
-- DAUERMAASSNAHME 1: Fan-Out Rate-Limiting in claim_pending_jobs_v4
-- Cap blueprint_variants jobs to max 3 per claim batch
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(
  p_worker_id text,
  p_limit integer DEFAULT 5,
  p_worker_pool text DEFAULT NULL
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_fanout_cap int := 3;  -- max blueprint_variants per claim batch
BEGIN
  RETURN QUERY
  WITH claimable_raw AS (
    SELECT jq.id, jq.job_type,
      ROW_NUMBER() OVER (
        PARTITION BY (jq.job_type = 'package_generate_blueprint_variants')
        ORDER BY jq.priority DESC NULLS LAST, jq.created_at ASC
      ) AS rn_fanout
    FROM job_queue jq
    LEFT JOIN course_packages cp ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN job_type_policies jtp ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
      AND (
        cp.id IS NULL
        OR cp.status = 'building'
        OR COALESCE(jtp.can_run_when_not_building, false)
      )
    ORDER BY jq.priority DESC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
  ),
  claimable AS (
    SELECT cr.id
    FROM claimable_raw cr
    WHERE NOT (
      cr.job_type = 'package_generate_blueprint_variants'
      AND cr.rn_fanout > v_fanout_cap
    )
    LIMIT p_limit
  )
  UPDATE job_queue q
  SET status = 'processing',
      started_at = now(),
      locked_by = p_worker_id,
      locked_at = now()
  FROM claimable c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- DAUERMAASSNAHME 2: Stale-Lock Auto-Recovery
-- Requeue STALE_LOCK_EXHAUSTED jobs with reset attempts + cooldown
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_recover_stale_lock_exhausted()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_recovered int := 0;
  v_details jsonb[] := ARRAY[]::jsonb[];
  v_max_recoveries int := 2;       -- max times we auto-recover same job
  v_cooldown_minutes int := 30;     -- backoff before retry
  rec record;
BEGIN
  FOR rec IN
    SELECT jq.id, jq.job_type, jq.package_id, jq.attempts, jq.max_attempts, jq.last_error,
           cp.status AS pkg_status,
           COALESCE((jq.meta->>'stale_lock_recoveries')::int, 0) AS prior_recoveries
    FROM job_queue jq
    LEFT JOIN course_packages cp ON cp.id = jq.package_id
    WHERE jq.status = 'failed'
      AND jq.last_error LIKE 'STALE_LOCK_EXHAUSTED%'
      AND jq.updated_at > now() - interval '24 hours'
      -- Only recover if package is still building
      AND (cp.id IS NULL OR cp.status = 'building')
    ORDER BY jq.updated_at DESC
    LIMIT 20
  LOOP
    -- Skip if already recovered too many times
    IF rec.prior_recoveries >= v_max_recoveries THEN
      CONTINUE;
    END IF;

    -- Requeue with reset attempts and cooldown
    UPDATE job_queue
    SET status = 'pending',
        attempts = 0,
        locked_at = NULL,
        locked_by = NULL,
        started_at = NULL,
        run_after = now() + (v_cooldown_minutes * interval '1 minute') * (1 + rec.prior_recoveries),
        last_error = format('AUTO_RECOVERED_STALE_LOCK: recovery #%s (was: %s)',
                           rec.prior_recoveries + 1, left(rec.last_error, 200)),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'stale_lock_recoveries', rec.prior_recoveries + 1,
          'last_auto_recovery_at', now()::text
        ),
        updated_at = now()
    WHERE id = rec.id;

    v_recovered := v_recovered + 1;
    v_details := v_details || jsonb_build_object(
      'job_id', rec.id,
      'job_type', rec.job_type,
      'package_id', rec.package_id,
      'recovery_number', rec.prior_recoveries + 1,
      'cooldown_min', v_cooldown_minutes * (1 + rec.prior_recoveries)
    );
  END LOOP;

  -- Log if any recoveries happened
  IF v_recovered > 0 THEN
    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail, metadata)
    VALUES (
      'stale_lock_auto_recovery',
      'fn_recover_stale_lock_exhausted',
      'job_queue',
      'applied',
      format('Recovered %s stale-lock-exhausted jobs', v_recovered),
      jsonb_build_object('recovered', v_recovered, 'details', to_jsonb(v_details))
    );
  END IF;

  RETURN jsonb_build_object(
    'recovered', v_recovered,
    'details', to_jsonb(v_details)
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- DAUERMAASSNAHME 3: Non-Building Job Reaper
-- Cancel pending jobs for packages no longer in building status
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_reap_non_building_pending_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cancelled int := 0;
  v_details jsonb[] := ARRAY[]::jsonb[];
  rec record;
BEGIN
  FOR rec IN
    SELECT jq.id, jq.job_type, jq.package_id, cp.status AS pkg_status
    FROM job_queue jq
    JOIN course_packages cp ON cp.id = jq.package_id
    LEFT JOIN job_type_policies jtp ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND cp.status NOT IN ('building')
      -- Respect policy whitelist
      AND NOT COALESCE(jtp.can_run_when_not_building, false)
      -- Only reap jobs older than 5 min to avoid race with status transitions
      AND jq.created_at < now() - interval '5 minutes'
    ORDER BY jq.created_at ASC
    LIMIT 200
  LOOP
    UPDATE job_queue
    SET status = 'cancelled',
        last_error = format('REAPED_NON_BUILDING: package status=%s', rec.pkg_status),
        updated_at = now()
    WHERE id = rec.id;

    v_cancelled := v_cancelled + 1;
    v_details := v_details || jsonb_build_object(
      'job_id', rec.id,
      'job_type', rec.job_type,
      'package_id', rec.package_id,
      'pkg_status', rec.pkg_status
    );
  END LOOP;

  IF v_cancelled > 0 THEN
    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail, metadata)
    VALUES (
      'non_building_job_reap',
      'fn_reap_non_building_pending_jobs',
      'job_queue',
      'applied',
      format('Cancelled %s pending jobs for non-building packages', v_cancelled),
      jsonb_build_object('cancelled', v_cancelled, 'details', to_jsonb(v_details))
    );
  END IF;

  RETURN jsonb_build_object(
    'cancelled', v_cancelled,
    'details', to_jsonb(v_details)
  );
END;
$$;
