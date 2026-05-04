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
  v_is_targeted_bp_fill boolean := false;
BEGIN
  IF NEW.status = 'processing'
     AND (OLD.status IS DISTINCT FROM 'processing')
     AND NEW.package_id IS NOT NULL
  THEN
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

    -- Phase A.2 (Ergänzung): targeted_blueprint_fill recovery
    v_is_targeted_bp_fill := (
      NEW.job_type = 'package_generate_blueprint_variants'
      AND (
        COALESCE(NEW.payload->>'mode','') = 'targeted_blueprint_fill'
        OR COALESCE(NEW.payload->>'_origin','') = 'targeted_fill_blueprint_recovery'
        OR COALESCE(NEW.payload->>'enqueue_source','') = 'targeted_fill_blueprint_recovery'
        OR jsonb_typeof(NEW.payload->'target_competency_ids') = 'array'
      )
    );

    IF v_is_targeted_exam_repair OR v_is_targeted_bp_fill THEN
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