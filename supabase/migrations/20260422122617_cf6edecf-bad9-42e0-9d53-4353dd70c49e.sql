CREATE OR REPLACE FUNCTION public.admin_resolve_repair_strategy_for_package(_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  FROM course_packages
  WHERE id = _package_id;

  IF NOT FOUND OR v_pkg.curriculum_id IS NULL THEN
    RETURN jsonb_build_object(
      'strategy','manual_review_required',
      'reason','no_package_or_curriculum'
    );
  END IF;

  v_curriculum_id := v_pkg.curriculum_id;

  SELECT count(*) INTO v_active_repair_count
  FROM job_queue
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
  FROM job_queue
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
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = v_curriculum_id;

  IF v_total_competencies = 0 THEN
    RETURN jsonb_build_object(
      'strategy','manual_review_required',
      'reason','no_competencies_in_curriculum'
    );
  END IF;

  -- FIX: exam_questions has no package_id column — filter via curriculum_id (SSOT)
  SELECT array_agg(c.id) INTO v_competencies_missing_questions
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = v_curriculum_id
    AND NOT EXISTS (
      SELECT 1 FROM exam_questions q
      WHERE q.competency_id = c.id
        AND q.curriculum_id = v_curriculum_id
    );

  SELECT count(*) INTO v_total_blueprints
  FROM exam_blueprints b
  WHERE b.package_id = _package_id;

  IF v_competencies_missing_questions IS NULL OR array_length(v_competencies_missing_questions,1) IS NULL THEN
    v_strategy := 'no_action_no_deficit';
    v_job_type := NULL;
    v_payload  := '{}'::jsonb;
    v_reason   := 'all_competencies_have_questions';
  ELSIF v_total_blueprints = 0 THEN
    v_strategy := 'package_repair_exam_pool_lf_coverage';
    v_job_type := 'package_repair_exam_pool_lf_coverage';
    v_payload  := jsonb_build_object('mode','blueprint_seed','package_id',_package_id);
    v_reason   := 'no_blueprints_yet';
  ELSE
    v_strategy := 'package_repair_exam_pool_competency_coverage';
    v_job_type := 'package_repair_exam_pool_competency_coverage';
    v_payload  := jsonb_build_object(
      'mode','targeted_competency_fill',
      'package_id',_package_id,
      'competency_ids', to_jsonb(v_competencies_missing_questions)
    );
    v_reason := format('missing_questions_for_%s_competencies', array_length(v_competencies_missing_questions,1));
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