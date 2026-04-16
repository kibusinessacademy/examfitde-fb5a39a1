CREATE OR REPLACE FUNCTION public.auto_ops_cycle()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_depth_heal jsonb;
  v_count int;
BEGIN
  -- ── MATERIALIZE ready steps → jobs ──
  BEGIN
    v_count := fn_materialize_ready_step_jobs();
    v_result := v_result || jsonb_build_object('jobs_materialized', v_count);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('materialize_error', SQLERRM);
  END;

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

  -- ── RETRY failed jobs (SAFE: exclude permanent & terminal failures) ──
  BEGIN
    WITH retryable AS (
      SELECT id
      FROM job_queue
      WHERE status = 'failed'
        AND attempts < max_attempts
        AND created_at > now() - interval '7 days'
        AND COALESCE((result->>'permanent')::boolean, false) = false
        AND COALESCE(last_error, '') NOT ILIKE '%"last_error_class":"permanent"%'
        AND COALESCE(last_error, '') NOT ILIKE '%SSOT_GUARD%'
        AND COALESCE(last_error, '') NOT ILIKE '%HTTP 422 PERMANENT%'
        AND COALESCE(error, '') NOT ILIKE '%SSOT_GUARD%'
        AND COALESCE(error, '') NOT ILIKE '%HTTP 422 PERMANENT%'
        -- ── Terminal failure exclusions (prevent infinite retry loops) ──
        AND COALESCE(last_error, '') NOT ILIKE '%HARD_FAIL%'
        AND COALESCE(last_error, '') NOT ILIKE '%HARD_FAIL_BREAKER%'
        AND COALESCE(last_error, '') NOT ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%'
        AND COALESCE(last_error, '') NOT ILIKE '%terminal_escalation%'
        AND COALESCE(error, '') NOT ILIKE '%HARD_FAIL%'
        -- ── Also skip jobs whose meta marks them as terminal ──
        AND COALESCE((meta->>'terminal_escalation')::boolean, false) = false
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

  -- ── RESCUE stuck processing ──
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
$function$;