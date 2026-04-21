-- =====================================================================
-- PATTERN 2: Empty-Blueprint Repair Helper
-- =====================================================================
-- Findet approved Blueprints ohne approved Fragen, gruppiert nach LF,
-- enqueued pro LF einen package_generate_exam_pool Fan-Out-Job mit
-- blueprint_ids Subscope. Nutzt vorhandenen Repair-Pfad — KEIN neuer
-- job_type, KEINE neue Edge Function.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.enqueue_empty_blueprint_repair(
  p_package_id uuid
)
RETURNS TABLE(
  learning_field_id uuid,
  empty_bp_count integer,
  job_id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_course_id uuid;
  v_lf_record record;
  v_existing_job_id uuid;
  v_new_job_id uuid;
  v_lf_existing integer;
BEGIN
  -- Resolve curriculum + course
  SELECT cp.curriculum_id, cp.course_id
    INTO v_curriculum_id, v_course_id
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RAISE EXCEPTION 'enqueue_empty_blueprint_repair: package % not found', p_package_id;
  END IF;

  -- Loop over LFs that have empty approved BPs
  FOR v_lf_record IN
    SELECT
      qb.learning_field_id AS lf_id,
      array_agg(qb.id ORDER BY qb.id) AS bp_ids,
      COUNT(*)::int AS empty_count
    FROM question_blueprints qb
    WHERE qb.curriculum_id = v_curriculum_id
      AND qb.status = 'approved'
      AND qb.learning_field_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM exam_questions eq
        WHERE eq.blueprint_id = qb.id AND eq.status = 'approved'
      )
    GROUP BY qb.learning_field_id
    HAVING COUNT(*) > 0
  LOOP
    -- Dedup: skip if active fan-out for same LF + package already queued/processing
    SELECT jq.id INTO v_existing_job_id
    FROM job_queue jq
    WHERE jq.job_type = 'package_generate_exam_pool'
      AND jq.status IN ('pending','processing')
      AND jq.payload->>'package_id' = p_package_id::text
      AND jq.payload->>'learning_field_filter' = v_lf_record.lf_id::text
      AND (jq.payload->>'_fan_out')::boolean IS TRUE
    LIMIT 1;

    IF v_existing_job_id IS NOT NULL THEN
      learning_field_id := v_lf_record.lf_id;
      empty_bp_count := v_lf_record.empty_count;
      job_id := v_existing_job_id;
      status := 'skipped_active_job';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Count existing approved questions in this LF (for lf_existing telemetry)
    SELECT COUNT(*)::int INTO v_lf_existing
    FROM exam_questions eq
    JOIN question_blueprints qb2 ON qb2.id = eq.blueprint_id
    WHERE qb2.learning_field_id = v_lf_record.lf_id
      AND qb2.curriculum_id = v_curriculum_id
      AND eq.status = 'approved';

    -- Enqueue fan-out job
    INSERT INTO job_queue (job_type, status, payload, priority, package_id)
    VALUES (
      'package_generate_exam_pool',
      'pending',
      jsonb_build_object(
        '_fan_out', true,
        'package_id', p_package_id,
        'curriculum_id', v_curriculum_id,
        'course_id', v_course_id,
        'learning_field_filter', v_lf_record.lf_id,
        'learning_field_id', v_lf_record.lf_id,
        'blueprint_ids', to_jsonb(v_lf_record.bp_ids),
        'lf_existing', v_lf_existing,
        'lf_target_total', v_lf_existing + v_lf_record.empty_count * 4,
        'lf_gap', v_lf_record.empty_count * 4,
        'options', jsonb_build_object('exam_target', 1000),
        'triggered_by', 'enqueue_empty_blueprint_repair',
        'repair_reason', 'empty_blueprints'
      ),
      8,
      p_package_id
    )
    RETURNING id INTO v_new_job_id;

    learning_field_id := v_lf_record.lf_id;
    empty_bp_count := v_lf_record.empty_count;
    job_id := v_new_job_id;
    status := 'enqueued';
    RETURN NEXT;
  END LOOP;

  -- Audit log
  INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, metadata)
  VALUES (
    'enqueue_empty_blueprint_repair',
    'enqueue_empty_blueprint_repair',
    'ok',
    format('Repair enqueued for package %s', p_package_id),
    jsonb_build_object('package_id', p_package_id, 'curriculum_id', v_curriculum_id)
  );

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_empty_blueprint_repair(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_empty_blueprint_repair(uuid) TO service_role;


-- =====================================================================
-- PATTERN 3: Conflict-Type Drain Stop-Guard
-- =====================================================================
-- Liefert: should_continue (bool), remaining_nulls (int), 
-- last_run_update_rate (numeric), last_run_error_count (int).
-- Stop wenn: remaining=0 ODER (errors > 50 in den letzten 3 Läufen)
-- ODER (update_rate < 5% in den letzten 3 Läufen)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_drain_conflict_type_backfill()
RETURNS TABLE(
  should_continue boolean,
  remaining_nulls bigint,
  recent_runs integer,
  recent_updated bigint,
  recent_errors bigint,
  recent_update_rate numeric,
  stop_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining bigint;
  v_runs integer := 0;
  v_updated bigint := 0;
  v_errors bigint := 0;
  v_rate numeric := 0;
  v_processed bigint := 0;
  v_stop text := NULL;
  v_continue boolean := true;
BEGIN
  -- Remaining NULL count
  SELECT COUNT(*) INTO v_remaining
  FROM exam_questions
  WHERE status = 'approved' AND conflict_type IS NULL;

  -- Last 3 backfill runs telemetry
  SELECT
    COUNT(*)::int,
    COALESCE(SUM((metadata->>'updated')::int), 0),
    COALESCE(SUM(jsonb_array_length(COALESCE(metadata->'errors','[]'::jsonb))), 0),
    COALESCE(SUM((metadata->>'updated')::int), 0)
  INTO v_runs, v_updated, v_errors, v_processed
  FROM auto_heal_log
  WHERE action_type = 'backfill_conflict_type'
    AND created_at > now() - interval '15 minutes'
  ORDER BY created_at DESC
  LIMIT 3;

  IF v_processed > 0 THEN
    v_rate := ROUND(100.0 * v_updated / GREATEST(v_processed, 1), 2);
  END IF;

  -- Stop guards
  IF v_remaining = 0 THEN
    v_stop := 'drain_complete';
    v_continue := false;
  ELSIF v_runs >= 3 AND v_errors > 50 THEN
    v_stop := 'error_spike';
    v_continue := false;
  END IF;

  should_continue := v_continue;
  remaining_nulls := v_remaining;
  recent_runs := v_runs;
  recent_updated := v_updated;
  recent_errors := v_errors;
  recent_update_rate := v_rate;
  stop_reason := v_stop;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_drain_conflict_type_backfill() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_drain_conflict_type_backfill() TO service_role;
