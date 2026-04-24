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
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resolve_repair_strategy_for_package(_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_pkg                            record;
  v_curriculum_id                  uuid;
  v_competencies_missing_questions uuid[];
  v_total_blueprints               int;
  v_total_competencies             int;
  v_active_repair_count            int;
  v_recent_no_effect_count         int;
  v_strategy                       text;
  v_job_type                       text;
  v_payload                        jsonb;
  v_reason                         text;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('strategy','forbidden','reason','admin_only');
  END IF;

  SELECT id, curriculum_id, status
    INTO v_pkg
  FROM public.course_packages
  WHERE id = _package_id;

  IF NOT FOUND OR v_pkg.curriculum_id IS NULL THEN
    RETURN jsonb_build_object(
      'strategy','manual_review_required',
      'reason','no_package_or_curriculum'
    );
  END IF;

  v_curriculum_id := v_pkg.curriculum_id;

  SELECT count(*) INTO v_active_repair_count
  FROM public.job_queue
  WHERE package_id = _package_id
    AND status = ANY(public.fn_job_active_statuses())
    AND job_type IN (
      'package_repair_exam_pool_competency_coverage',
      'package_repair_exam_pool_lf_coverage'
    );

  IF v_active_repair_count > 0 THEN
    RETURN jsonb_build_object(
      'strategy','no_action_active_job_exists',
      'reason', format('%s active repair job(s) exist', v_active_repair_count)
    );
  END IF;

  SELECT count(*) INTO v_recent_no_effect_count
  FROM public.job_queue
  WHERE package_id = _package_id
    AND job_type IN (
      'package_repair_exam_pool_competency_coverage',
      'package_repair_exam_pool_lf_coverage'
    )
    AND status IN ('failed','cancelled')
    AND COALESCE(updated_at, created_at) > now() - interval '24 hours'
    AND (
      COALESCE(meta->>'progress_delta','0')::int = 0
      OR COALESCE(last_error,'') ILIKE '%NO_EFFECT%'
      OR COALESCE(last_error,'') ILIKE '%NO_PROGRESS%'
    );

  IF v_recent_no_effect_count >= 2 THEN
    RETURN jsonb_build_object(
      'strategy','manual_review_required',
      'reason','recent_no_effect_or_no_progress_history'
    );
  END IF;

  SELECT count(*) INTO v_total_competencies
  FROM public.competencies c
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = v_curriculum_id;

  IF v_total_competencies = 0 THEN
    RETURN jsonb_build_object(
      'strategy','manual_review_required',
      'reason','no_competencies_in_curriculum'
    );
  END IF;

  SELECT COALESCE(array_agg(x.id), ARRAY[]::uuid[])
    INTO v_competencies_missing_questions
  FROM (
    SELECT c.id
    FROM public.competencies c
    JOIN public.learning_fields lf ON lf.id = c.learning_field_id
    LEFT JOIN public.exam_questions eq
      ON eq.competency_id = c.id
     AND eq.curriculum_id = v_curriculum_id
     AND (
       eq.status = 'approved'
       OR eq.qc_status = 'approved'
     )
    WHERE lf.curriculum_id = v_curriculum_id
    GROUP BY c.id
    HAVING COUNT(eq.id) < 3
  ) x;

  SELECT count(*) INTO v_total_blueprints
  FROM public.question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id
    AND qb.status = 'approved';

  IF array_length(v_competencies_missing_questions, 1) IS NULL THEN
    v_strategy := 'no_action_no_deficit';
    v_job_type := NULL;
    v_payload  := '{}'::jsonb;
    v_reason   := 'all_competencies_have_min_questions';
  ELSIF v_total_blueprints = 0 THEN
    v_strategy := 'package_repair_exam_pool_lf_coverage';
    v_job_type := 'package_repair_exam_pool_lf_coverage';
    v_payload  := jsonb_build_object(
      'package_id', _package_id,
      'curriculum_id', v_curriculum_id,
      'is_repair', true,
      'mode', 'targeted_blueprint_fill',
      'target_competency_ids', to_jsonb(v_competencies_missing_questions),
      'continuation_of_targeted_fill', false,
      'continuation_depth', 0,
      'source_cluster', 'REPAIR_COMPETENCY_COVERAGE'
    );
    v_reason := 'no_approved_question_blueprints';
  ELSE
    v_strategy := 'package_repair_exam_pool_competency_coverage';
    v_job_type := 'package_repair_exam_pool_competency_coverage';
    v_payload  := jsonb_build_object(
      'package_id', _package_id,
      'curriculum_id', v_curriculum_id,
      'is_repair', true,
      'mode', 'targeted_competency_fill',
      'target_competency_ids', to_jsonb(v_competencies_missing_questions),
      'continuation_of_targeted_fill', false,
      'continuation_depth', 0,
      'source_cluster', 'REPAIR_COMPETENCY_COVERAGE'
    );
    v_reason := format('missing_min_questions_for_%s_competencies', array_length(v_competencies_missing_questions,1));
  END IF;

  RETURN jsonb_build_object(
    'strategy', v_strategy,
    'job_type', v_job_type,
    'payload',  v_payload,
    'reason',   v_reason,
    'target_competency_ids', to_jsonb(COALESCE(v_competencies_missing_questions,'{}'::uuid[])),
    'total_competencies', v_total_competencies,
    'total_blueprints',   v_total_blueprints
  );
END;
$function$;