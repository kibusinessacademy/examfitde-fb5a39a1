-- ─────────────────────────────────────────────────────────────────────────────
-- Guard: auto_ops_cycle + auto_retry_stuck_package must NEVER retry permanent failures
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Patch auto_ops_cycle: exclude permanent failures from retry
CREATE OR REPLACE FUNCTION public.auto_ops_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_depth_heal jsonb;
  v_count int;
BEGIN
  BEGIN
    v_count := auto_link_certification_documents();
    v_result := v_result || jsonb_build_object('depth_linked', v_count);
    v_count := auto_seed_curriculum_topics();
    v_result := v_result || jsonb_build_object('depth_seeded', v_count);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('depth_error', SQLERRM);
  END;

  BEGIN
    v_depth_heal := auto_heal_shallow_content();
    v_result := v_result || jsonb_build_object('depth_heal', v_depth_heal);
  EXCEPTION WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('depth_heal_error', SQLERRM);
  END;

  -- ── RETRY failed jobs (SAFE: exclude permanent failures) ──
  BEGIN
    WITH retryable AS (
      SELECT id
      FROM job_queue
      WHERE status = 'failed'
        AND attempts < max_attempts
        AND created_at > now() - interval '7 days'
        -- DO NOT RETRY PERMANENT FAILURES
        AND COALESCE((result->>'permanent')::boolean, false) = false
        AND COALESCE(last_error, '') NOT ILIKE '%"last_error_class":"permanent"%'
        AND COALESCE(last_error, '') NOT ILIKE '%SSOT_GUARD%'
        AND COALESCE(last_error, '') NOT ILIKE '%HTTP 422 PERMANENT%'
        AND COALESCE(error, '') NOT ILIKE '%SSOT_GUARD%'
        AND COALESCE(error, '') NOT ILIKE '%HTTP 422 PERMANENT%'
      ORDER BY updated_at DESC
      LIMIT 20
    )
    UPDATE job_queue
    SET status = 'pending',
        run_after = now() + interval '30 seconds',
        updated_at = now(),
        locked_at = NULL,
        locked_by = NULL
    WHERE id IN (SELECT id FROM retryable);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('jobs_retried', v_count);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('retry_error', SQLERRM);
  END;

  -- ── RESCUE stuck processing (unchanged) ──
  BEGIN
    WITH stuck AS (
      SELECT id FROM job_queue
      WHERE status = 'processing'
        AND started_at < now() - interval '15 minutes'
      LIMIT 10
    )
    UPDATE job_queue
    SET status = 'pending',
        run_after = now() + interval '1 minute',
        updated_at = now(),
        locked_at = NULL,
        locked_by = NULL
    WHERE id IN (SELECT id FROM stuck);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('stuck_rescued', v_count);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('stuck_error', SQLERRM);
  END;

  BEGIN
    DELETE FROM pipeline_lock WHERE locked_at < now() - interval '30 minutes';
    DELETE FROM course_generation_locks WHERE locked_at < now() - interval '30 minutes';
    v_result := v_result || jsonb_build_object('locks_cleaned', true);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('locks_error', SQLERRM);
  END;

  RETURN v_result;
END;
$$;

-- 2) Patch auto_retry_stuck_package: use run_after (not scheduled_at), exclude permanent
CREATE OR REPLACE FUNCTION public.auto_retry_stuck_package(p_package_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  retried integer := 0;
BEGIN
  UPDATE job_queue
  SET status = 'pending',
      run_after = now() + interval '30 seconds',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now()
  WHERE status = 'failed'
    AND (payload->>'package_id')::uuid = p_package_id
    AND attempts < max_attempts
    -- Only retry transient failures
    AND (
      COALESCE(last_error_code, '') IN ('RATE_LIMIT', 'TIMEOUT', 'STALE_LOCK')
      OR COALESCE(last_error, '') ILIKE '%rate limit%'
      OR COALESCE(last_error, '') ILIKE '%timeout%'
      OR COALESCE(last_error, '') ILIKE '%transient%'
      OR COALESCE(error, '') ILIKE '%rate limit%'
      OR COALESCE(error, '') ILIKE '%timeout%'
    )
    -- DO NOT RETRY PERMANENT FAILURES
    AND COALESCE((result->>'permanent')::boolean, false) = false
    AND COALESCE(last_error, '') NOT ILIKE '%"last_error_class":"permanent"%'
    AND COALESCE(last_error, '') NOT ILIKE '%SSOT_GUARD%'
    AND COALESCE(last_error, '') NOT ILIKE '%HTTP 422 PERMANENT%'
    AND COALESCE(error, '') NOT ILIKE '%SSOT_GUARD%'
    AND COALESCE(error, '') NOT ILIKE '%HTTP 422 PERMANENT%';

  GET DIAGNOSTICS retried = ROW_COUNT;

  IF retried > 0 THEN
    UPDATE course_packages
    SET stuck_reason = NULL, updated_at = now()
    WHERE id = p_package_id;
  END IF;

  RETURN retried;
END;
$$;