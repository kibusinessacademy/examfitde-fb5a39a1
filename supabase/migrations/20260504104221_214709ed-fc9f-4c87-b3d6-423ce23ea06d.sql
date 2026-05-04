-- Erweitert fn_competency_repair_tail_reset: Bei remaining > 0 wird die Continuation
-- jetzt vom Trigger enqueued (statt vom Worker), weil der UNIQUE-Index
-- uq_job_queue_active_package_job parallele active package_generate_exam_pool
-- pro Paket verhindert. Im Trigger ist NEW.status='completed' → kein Konflikt mehr.

CREATE OR REPLACE FUNCTION public.fn_competency_repair_tail_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_id uuid;
  v_curriculum_id uuid;
  v_remaining int;
  v_remaining_ids jsonb;
  v_steps_reset int := 0;
  v_validate_job_id uuid;
  v_next_depth int;
  v_max_depth constant int := 20;
  v_existing_active int;
  v_continuation_job_id uuid;
  v_root_job_id uuid;
BEGIN
  -- Only fire on completed package_generate_exam_pool with repair-tags + tail-requeue-flag
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;
  IF NEW.job_type <> 'package_generate_exam_pool' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.payload->>'_origin','') <> 'competency_coverage_repair'
     AND COALESCE(NEW.payload->>'mode','') <> 'targeted_competency_fill' THEN
    RETURN NEW;
  END IF;
  IF COALESCE((NEW.payload->>'requeue_tail_after_success')::boolean, false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_pkg_id := COALESCE((NEW.payload->>'package_id')::uuid, NEW.package_id);
  v_curriculum_id := (NEW.payload->>'curriculum_id')::uuid;
  v_remaining := COALESCE((NEW.result->>'remaining_target_competencies')::int, -1);
  v_remaining_ids := COALESCE(NEW.result->'remaining_target_competency_ids', '[]'::jsonb);
  v_next_depth := COALESCE((NEW.payload->>'continuation_depth')::int, 0) + 1;
  v_root_job_id := COALESCE((NEW.payload->>'root_job_id')::uuid, NEW.id);

  -- ============================================================
  -- BRANCH A: remaining > 0 → enqueue continuation depth+1
  -- ============================================================
  IF v_remaining > 0 AND jsonb_array_length(v_remaining_ids) > 0 THEN
    -- Depth cap
    IF v_next_depth > v_max_depth THEN
      INSERT INTO public.auto_heal_log
        (action_type, target_type, target_id, result_status, result_detail, metadata)
      VALUES (
        'targeted_competency_fill_continuation_depth_exceeded',
        'course_package', v_pkg_id::text, 'failed',
        format('depth %s > max %s', v_next_depth, v_max_depth),
        jsonb_build_object(
          'package_id', v_pkg_id, 'source_job_id', NEW.id,
          'continuation_depth', v_next_depth - 1,
          'remaining', v_remaining
        )
      );
      RETURN NEW;
    END IF;

    -- Idempotency: skip if already a pending/processing targeted continuation for this package
    SELECT count(*) INTO v_existing_active
    FROM public.job_queue
    WHERE package_id = v_pkg_id
      AND job_type = 'package_generate_exam_pool'
      AND status IN ('pending','queued','processing')
      AND payload->>'mode' = 'targeted_competency_fill'
      AND payload->>'enqueue_source' = 'competency_coverage_repair';

    IF v_existing_active > 0 THEN
      INSERT INTO public.auto_heal_log
        (action_type, target_type, target_id, result_status, result_detail, metadata)
      VALUES (
        'targeted_competency_fill_continuation_skipped',
        'course_package', v_pkg_id::text, 'skipped',
        format('active continuation already exists (count=%s)', v_existing_active),
        jsonb_build_object(
          'package_id', v_pkg_id, 'source_job_id', NEW.id,
          'next_depth', v_next_depth, 'remaining', v_remaining
        )
      );
      RETURN NEW;
    END IF;

    -- Enqueue continuation (vorgänger ist completed → kein UNIQUE-Konflikt)
    INSERT INTO public.job_queue
      (job_type, package_id, status, priority, max_attempts, payload, meta)
    VALUES (
      'package_generate_exam_pool',
      v_pkg_id,
      'pending',
      25,
      3,
      jsonb_build_object(
        'package_id', v_pkg_id,
        'curriculum_id', v_curriculum_id,
        'mode', 'targeted_competency_fill',
        'enqueue_source', 'competency_coverage_repair',
        '_origin', 'competency_coverage_repair',
        'origin', 'targeted_fill_continuation',
        'cluster', 'targeted_fill_continuation',
        'reason', 'COVERAGE_GAP_BELOW_TRACK_THRESHOLD',
        'target_competency_ids', v_remaining_ids,
        'continuation_depth', v_next_depth,
        'continuation_of_targeted_fill', true,
        'requeue_tail_after_success', true,
        'root_job_id', v_root_job_id,
        'parent_job_id', NEW.id,
        'triggered_by', 'fn_competency_repair_tail_reset'
      ),
      jsonb_build_object(
        'origin', 'targeted_fill_continuation',
        'parent_job_id', NEW.id,
        'root_job_id', v_root_job_id,
        'continuation_depth', v_next_depth,
        'enqueued_by_trigger', 'fn_competency_repair_tail_reset'
      )
    )
    RETURNING id INTO v_continuation_job_id;

    INSERT INTO public.auto_heal_log
      (action_type, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'targeted_competency_fill_continuation_enqueued',
      'course_package', v_pkg_id::text, 'success',
      format('continuation depth=%s remaining=%s (enqueued by trigger)', v_next_depth, v_remaining),
      jsonb_build_object(
        'package_id', v_pkg_id,
        'parent_job_id', NEW.id,
        'continuation_job_id', v_continuation_job_id,
        'continuation_depth', v_next_depth,
        'remaining_target_competency_ids', v_remaining_ids,
        'enqueued_by', 'trigger'
      )
    );

    -- Also emit partial audit (kept for parity with old behavior)
    INSERT INTO public.auto_heal_log
      (action_type, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'competency_filter_generation_completed',
      'course_package', v_pkg_id::text, 'partial',
      format('targeted_competency_fill partial: %s remaining (continuation enqueued)', v_remaining),
      jsonb_build_object(
        'package_id', v_pkg_id, 'job_id', NEW.id,
        'remaining_target_competencies', v_remaining,
        'continuation_depth', COALESCE((NEW.payload->>'continuation_depth')::int, 0),
        'continuation_job_id', v_continuation_job_id
      )
    );

    RETURN NEW;
  END IF;

  -- remaining < 0 (= field missing): treat as no-op (worker did not report)
  IF v_remaining < 0 THEN
    RETURN NEW;
  END IF;

  -- ============================================================
  -- BRANCH B: remaining = 0 → reset tail + enqueue validate
  -- ============================================================
  UPDATE public.package_steps
  SET status = 'queued',
      started_at = NULL,
      updated_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'allow_regression_by', 'repair_rpc',
        'reset_by', 'fn_competency_repair_tail_reset',
        'reset_source_job_id', NEW.id::text,
        'reset_at', now()::text,
        'reset_reason', 'targeted_competency_fill_completed'
      )
  WHERE package_id = v_pkg_id
    AND step_key IN ('validate_exam_pool','run_integrity_check','quality_council','auto_publish')
    AND status IN ('done','failed','blocked','skipped');

  GET DIAGNOSTICS v_steps_reset = ROW_COUNT;

  IF v_steps_reset > 0 THEN
    INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, payload, meta)
    VALUES (
      'package_validate_exam_pool', v_pkg_id, 'pending', 20, 3,
      jsonb_build_object(
        'package_id', v_pkg_id,
        'curriculum_id', v_curriculum_id,
        'step_key', 'validate_exam_pool',
        'enqueue_source', 'competency_coverage_repair_tail_reset',
        'triggered_by_repair_job', NEW.id::text
      ),
      jsonb_build_object(
        'origin', 'competency_repair_tail_reset',
        'parent_job_id', NEW.id
      )
    )
    RETURNING id INTO v_validate_job_id;
  END IF;

  INSERT INTO public.auto_heal_log
    (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'competency_coverage_repair_materialized',
    'course_package', v_pkg_id::text, 'success',
    format('targeted_competency_fill complete; reset %s tail steps + enqueued validate_exam_pool', v_steps_reset),
    jsonb_build_object(
      'package_id', v_pkg_id, 'curriculum_id', v_curriculum_id,
      'source_job_id', NEW.id,
      'tail_steps_reset', v_steps_reset,
      'validate_job_id', v_validate_job_id,
      'continuation_depth', COALESCE((NEW.payload->>'continuation_depth')::int, 0)
    )
  );

  INSERT INTO public.auto_heal_log
    (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'competency_filter_generation_completed',
    'course_package', v_pkg_id::text, 'success',
    'targeted_competency_fill completed (no remaining competencies)',
    jsonb_build_object(
      'package_id', v_pkg_id, 'job_id', NEW.id,
      'inserted_questions', COALESCE((NEW.result->>'inserted_questions')::int, 0),
      'processed_competencies', COALESCE((NEW.result->>'processed_competencies')::int, 0)
    )
  );

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_competency_repair_tail_reset IS
  'Trigger AFTER UPDATE: bei targeted_competency_fill completed → entweder Continuation depth+1 enqueuen (remaining>0) oder Tail reset+validate enqueue (remaining=0). Continuation läuft hier statt im Worker, weil uq_job_queue_active_package_job parallele active jobs verbietet — im Trigger ist Vorgänger bereits completed.';