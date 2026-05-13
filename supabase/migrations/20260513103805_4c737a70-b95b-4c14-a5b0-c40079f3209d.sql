CREATE OR REPLACE FUNCTION public.fn_guard_obsolete_processing_jobs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
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
  v_is_targeted_lf_repair boolean := false;
  v_origin text;
  v_mode text;
BEGIN
  IF NEW.status = 'processing'
     AND (OLD.status IS DISTINCT FROM 'processing')
     AND NEW.package_id IS NOT NULL
  THEN
    v_origin := COALESCE(NEW.payload->>'_origin','');
    v_mode   := COALESCE(NEW.payload->>'mode','');

    -- Hard-bypass: targeted blueprint recovery
    IF NEW.job_type = 'package_generate_blueprint_variants'
       AND v_mode = 'targeted_blueprint_fill'
    THEN
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, details)
      VALUES ('obsolete_processing_guard_bypass','job', NEW.id::text,'bypassed',
              jsonb_build_object('reason','targeted_blueprint_fill','job_type',NEW.job_type,'package_id',NEW.package_id));
      RETURN NEW;
    END IF;

    -- Bypass: targeted competency fill (exam pool repair)
    v_is_targeted_exam_repair := (
      NEW.job_type = 'package_generate_exam_pool'
      AND (
        v_origin = 'enqueue_competency_coverage_repair'
        OR v_mode = 'targeted_competency_fill'
        OR COALESCE((NEW.payload->>'is_repair')::boolean, false) = true
        OR jsonb_typeof(NEW.payload->'target_competency_ids') = 'array'
      )
    );

    IF v_is_targeted_exam_repair THEN
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, details)
      VALUES ('obsolete_processing_guard_bypass','job', NEW.id::text,'bypassed',
              jsonb_build_object('reason','targeted_competency_fill','job_type',NEW.job_type,'package_id',NEW.package_id,'origin',v_origin,'mode',v_mode));
      RETURN NEW;
    END IF;

    -- Bypass: targeted LF coverage repair (this migration)
    v_is_targeted_lf_repair := (
      NEW.job_type IN ('package_generate_exam_pool','package_repair_exam_pool_lf_coverage')
      AND (
        v_origin IN ('enqueue_lf_coverage_repair','repair_lf_coverage')
        OR v_mode = 'targeted_lf_fill'
        OR jsonb_typeof(NEW.payload->'learning_field_filter') IS NOT NULL
        OR (NEW.payload ? 'lf_target_total')
      )
    );

    IF v_is_targeted_lf_repair THEN
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, details)
      VALUES ('obsolete_processing_guard_bypass','job', NEW.id::text,'bypassed',
              jsonb_build_object('reason','targeted_lf_fill','job_type',NEW.job_type,'package_id',NEW.package_id,'origin',v_origin,'mode',v_mode));
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