CREATE OR REPLACE FUNCTION public.fn_guard_obsolete_processing_jobs()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_step_key text;
  v_step_status text;
  v_step_map jsonb := '{
    "package_generate_exam_pool": "generate_exam_pool",
    "package_generate_handbook": "generate_handbook",
    "package_generate_oral_exam": "generate_oral_exam",
    "package_generate_glossary": "generate_glossary",
    "package_generate_lesson_minichecks": "generate_lesson_minichecks",
    "package_validate_learning_content": "validate_learning_content",
    "package_validate_exam_pool": "validate_exam_pool",
    "package_validate_handbook": "validate_handbook",
    "package_validate_handbook_depth": "validate_handbook_depth",
    "package_validate_oral_exam": "validate_oral_exam",
    "package_validate_lesson_minichecks": "validate_lesson_minichecks",
    "package_validate_tutor_index": "validate_tutor_index",
    "package_validate_blueprints": "validate_blueprints",
    "package_validate_blueprint_variants": "validate_blueprint_variants",
    "package_generate_blueprint_variants": "generate_blueprint_variants",
    "package_promote_blueprint_variants": "promote_blueprint_variants",
    "package_finalize_learning_content": "finalize_learning_content",
    "package_run_integrity_check": "run_integrity_check",
    "package_quality_council": "quality_council",
    "package_elite_harden": "elite_harden",
    "package_auto_publish": "auto_publish",
    "package_build_ai_tutor_index": "build_ai_tutor_index",
    "package_scaffold_learning_course": "scaffold_learning_course",
    "package_fanout_learning_content": "fanout_learning_content",
    "package_generate_learning_content": "generate_learning_content"
  }'::jsonb;
  v_is_targeted_exam_repair boolean := false;
BEGIN
  IF NEW.status = 'processing'
     AND (OLD.status IS DISTINCT FROM 'processing')
     AND NEW.package_id IS NOT NULL
  THEN
    -- Minimal hard-bypass: targeted blueprint recovery must not be cancelled by step state.
    IF NEW.job_type = 'package_generate_blueprint_variants'
       AND COALESCE(NEW.payload->>'mode','') = 'targeted_blueprint_fill'
    THEN
      RETURN NEW;
    END IF;

    -- Existing bypass: targeted_competency_fill (exam pool repair)
    v_is_targeted_exam_repair := (
      NEW.job_type = 'package_generate_exam_pool'
      AND (
        COALESCE(NEW.payload->>'_origin','') = 'enqueue_competency_coverage_repair'
        OR COALESCE(NEW.payload->>'mode','') = 'targeted_competency_fill'
        OR COALESCE((NEW.payload->>'is_repair')::boolean, false) = true
        OR jsonb_typeof(NEW.payload->'target_competency_ids') = 'array'
      )
    );

    IF v_is_targeted_exam_repair THEN
      RETURN NEW;
    END IF;

    v_step_key := v_step_map->>NEW.job_type;

    IF v_step_key IS NOT NULL THEN
      SELECT status INTO v_step_status
      FROM public.package_steps
      WHERE package_id = NEW.package_id AND step_key = v_step_key;

      IF v_step_status IN ('done', 'skipped') THEN
        NEW.status := 'cancelled';
        NEW.completed_at := now();
        NEW.last_error := jsonb_build_object(
          'last_error_kind', 'preempted_by_step_state',
          'last_error_message', format('step_already_%s_at_processing_start', v_step_status),
          'cancelled_by', 'fn_guard_obsolete_processing_jobs',
          'at', now()::text
        )::text;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_blueprint_fill_completion_to_competency_fill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_package_id uuid;
  v_curriculum_id uuid;
  v_target_ids jsonb;
  v_target_id_array text[];
  v_inserted_blueprints int;
  v_existing_blueprints int := 0;
  v_treat_as_existing_success boolean := false;
  v_idem_key text;
  v_target_per_competency int;
  v_payload jsonb;
BEGIN
  -- Only react to package_generate_blueprint_variants completions in mode=targeted_blueprint_fill
  IF NEW.job_type <> 'package_generate_blueprint_variants' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.payload->>'mode','') <> 'targeted_blueprint_fill' THEN
    RETURN NEW;
  END IF;

  v_package_id    := COALESCE((NEW.payload->>'package_id')::uuid, NEW.package_id);
  v_curriculum_id := (NEW.payload->>'curriculum_id')::uuid;
  v_target_ids    := COALESCE(NEW.result->'target_competency_ids', NEW.result->'target_competencies', NEW.payload->'target_competency_ids', '[]'::jsonb);
  v_inserted_blueprints := COALESCE((NEW.result->>'inserted_blueprints')::int, 0);
  v_target_per_competency := COALESCE((NEW.payload->>'target_per_competency')::int, 6);

  IF v_package_id IS NULL OR v_curriculum_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(v_target_ids) ORDER BY 1)
    INTO v_target_id_array;

  IF COALESCE(array_length(v_target_id_array, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;

  IF v_inserted_blueprints <= 0 THEN
    SELECT COUNT(*)::int
      INTO v_existing_blueprints
    FROM public.question_blueprints qb
    WHERE qb.package_id = v_package_id
      AND qb.curriculum_id = v_curriculum_id
      AND qb.competency_id = ANY(v_target_id_array::uuid[])
      AND qb.status IN ('draft','approved');

    v_treat_as_existing_success := v_existing_blueprints > 0;
  END IF;

  -- Skip only if nothing was inserted and no target blueprints exist.
  IF v_inserted_blueprints <= 0 AND NOT v_treat_as_existing_success THEN
    INSERT INTO public.auto_heal_log (
      action_type, target_type, target_id, result_status, result_detail, metadata
    ) VALUES (
      'targeted_blueprint_fill_continuation_skipped',
      'course_package',
      v_package_id,
      'noop',
      'inserted_blueprints=0 and no existing target blueprints — no continuation enqueued',
      jsonb_build_object(
        'source_job_id', NEW.id,
        'package_id', v_package_id,
        'inserted_blueprints', v_inserted_blueprints,
        'existing_blueprints', v_existing_blueprints,
        'reason', COALESCE(NEW.result->>'reason', 'NO_TARGETED_BLUEPRINTS_INSERTED')
      )
    );
    RETURN NEW;
  END IF;

  -- Build deterministic idempotency-key
  -- Sorted target ids → stable hash regardless of payload ordering
  v_idem_key := 'bpfill2compfill:' || v_package_id::text || ':'
                || encode(digest(array_to_string(v_target_id_array, ','), 'sha256'), 'hex');

  v_payload := jsonb_build_object(
    'package_id', v_package_id,
    'curriculum_id', v_curriculum_id,
    'mode', 'targeted_competency_fill',
    'is_repair', true,
    'target_competency_ids', to_jsonb(v_target_id_array),
    'target_per_competency', v_target_per_competency,
    'step_key', 'generate_exam_pool',
    'enqueue_source', 'targeted_fill_blueprint_recovery',
    '_origin', 'targeted_fill_blueprint_recovery',
    '_origin_job_id', NEW.id,
    'continuation_depth', COALESCE((NEW.payload->>'continuation_depth')::int, 0) + 1,
    'continuation_key', v_idem_key,
    'parent_job_id', NEW.id,
    'root_job_id', COALESCE((NEW.payload->>'root_job_id')::uuid, NEW.id),
    'requeue_tail_after_success', true
  );

  -- Insert continuation job; rely on unique partial index job_queue_idempotency_active
  -- to guarantee at-most-one active continuation per (package, target-set).
  BEGIN
    INSERT INTO public.job_queue (
      job_type, status, payload, package_id, idempotency_key, priority,
      worker_pool, parent_job_id, root_job_id
    ) VALUES (
      'package_generate_exam_pool',
      'pending',
      v_payload,
      v_package_id,
      v_idem_key,
      25,
      'default',
      NEW.id,
      COALESCE((NEW.payload->>'root_job_id')::uuid, NEW.id)
    );

    INSERT INTO public.auto_heal_log (
      action_type, target_type, target_id, result_status, result_detail, metadata
    ) VALUES (
      'targeted_blueprint_fill_continuation_enqueued',
      'course_package',
      v_package_id,
      'success',
      format('enqueued targeted_competency_fill for %s competencies (inserted_blueprints=%s existing_blueprints=%s)',
             array_length(v_target_id_array, 1), v_inserted_blueprints, v_existing_blueprints),
      jsonb_build_object(
        'source_job_id', NEW.id,
        'package_id', v_package_id,
        'idempotency_key', v_idem_key,
        'target_competency_ids', to_jsonb(v_target_id_array),
        'inserted_blueprints', v_inserted_blueprints,
        'existing_blueprints', v_existing_blueprints,
        'completed_existing_blueprints', v_treat_as_existing_success
      )
    );

  EXCEPTION WHEN unique_violation THEN
    -- Active continuation already exists — handled by trigger, not an error
    INSERT INTO public.auto_heal_log (
      action_type, target_type, target_id, result_status, result_detail, metadata
    ) VALUES (
      'targeted_blueprint_fill_continuation_deferred',
      'course_package',
      v_package_id,
      'noop',
      'unique_violation on idempotency_key — handled by existing active job',
      jsonb_build_object(
        'source_job_id', NEW.id,
        'idempotency_key', v_idem_key,
        'sqlstate', SQLSTATE,
        'note', 'deferred/handled by trigger'
      )
    );
  END;

  RETURN NEW;
END;
$function$;