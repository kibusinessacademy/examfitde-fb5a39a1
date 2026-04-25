-- Repair-Routing v3.1 — Subquery + Filter-Konsistenz + Difficulty-Guard

CREATE OR REPLACE FUNCTION public.admin_resolve_repair_strategy_for_package(_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg record;
  v_curriculum_id uuid;
  v_competencies_missing_questions uuid[];
  v_lf_missing uuid[];
  v_total_blueprints int;
  v_total_competencies int;
  v_total_lf int;
  v_active_repair_count int;
  v_recent_no_effect_count int;
  v_approved_total int;
  v_hardish_count int;
  v_hardish_pct numeric;
  v_target_hardish_pct numeric := 35;
  v_strategy text;
  v_job_type text;
  v_payload jsonb;
  v_reason text;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('strategy','forbidden','reason','admin_only');
  END IF;

  SELECT id, curriculum_id, status, track INTO v_pkg
  FROM public.course_packages WHERE id = _package_id;

  IF NOT FOUND OR v_pkg.curriculum_id IS NULL THEN
    RETURN jsonb_build_object('strategy','manual_review_required','reason','no_package_or_curriculum');
  END IF;

  v_curriculum_id := v_pkg.curriculum_id;

  IF v_pkg.track = 'EXAM_FIRST_PLUS' THEN v_target_hardish_pct := 45;
  ELSIF v_pkg.track = 'EXAM_FIRST' THEN v_target_hardish_pct := 35;
  END IF;

  SELECT count(*) INTO v_active_repair_count
  FROM public.job_queue
  WHERE package_id = _package_id
    AND status = ANY(public.fn_job_active_statuses())
    AND job_type IN (
      'package_repair_exam_pool_competency_coverage',
      'package_repair_exam_pool_lf_coverage',
      'package_repair_exam_pool_quality'
    );

  IF v_active_repair_count > 0 THEN
    RETURN jsonb_build_object('strategy','no_action_active_job_exists',
      'reason', format('%s active repair job(s) exist', v_active_repair_count));
  END IF;

  SELECT count(*) INTO v_recent_no_effect_count
  FROM public.job_queue
  WHERE package_id = _package_id
    AND job_type IN (
      'package_repair_exam_pool_competency_coverage',
      'package_repair_exam_pool_lf_coverage',
      'package_repair_exam_pool_quality'
    )
    AND status IN ('failed','cancelled')
    AND COALESCE(updated_at, created_at) > now() - interval '24 hours'
    AND (
      COALESCE(meta->>'progress_delta','0')::int = 0
      OR COALESCE(last_error,'') ILIKE '%NO_EFFECT%'
      OR COALESCE(last_error,'') ILIKE '%NO_PROGRESS%'
    );

  IF v_recent_no_effect_count >= 3 THEN
    RETURN jsonb_build_object('strategy','manual_review_required',
      'reason','recent_no_effect_or_no_progress_history');
  END IF;

  SELECT count(*) INTO v_total_lf
  FROM public.learning_fields lf WHERE lf.curriculum_id = v_curriculum_id;

  SELECT count(*) INTO v_total_competencies
  FROM public.competencies c
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = v_curriculum_id;

  IF v_total_competencies = 0 OR v_total_lf = 0 THEN
    RETURN jsonb_build_object('strategy','manual_review_required','reason','no_curriculum_structure');
  END IF;

  -- FIX #1: LF-missing als Subquery (verhindert "query returned more than one row")
  -- FIX #2: Approved-Filter einheitlich (status / qc_status / review_state)
  SELECT COALESCE(array_agg(x.id), ARRAY[]::uuid[]) INTO v_lf_missing
  FROM (
    SELECT lf.id
    FROM public.learning_fields lf
    LEFT JOIN public.exam_questions eq
      ON eq.learning_field_id = lf.id
     AND eq.curriculum_id = v_curriculum_id
     AND (eq.status = 'approved' OR eq.qc_status = 'approved' OR eq.review_state = 'approved')
    WHERE lf.curriculum_id = v_curriculum_id
    GROUP BY lf.id
    HAVING COUNT(eq.id) = 0
  ) x;

  SELECT COALESCE(array_agg(x.id), ARRAY[]::uuid[]) INTO v_competencies_missing_questions
  FROM (
    SELECT c.id
    FROM public.competencies c
    JOIN public.learning_fields lf ON lf.id = c.learning_field_id
    LEFT JOIN public.exam_questions eq
      ON eq.competency_id = c.id
     AND eq.curriculum_id = v_curriculum_id
     AND (eq.status = 'approved' OR eq.qc_status = 'approved' OR eq.review_state = 'approved')
    WHERE lf.curriculum_id = v_curriculum_id
    GROUP BY c.id
    HAVING COUNT(eq.id) < 3
  ) x;

  SELECT count(*) INTO v_approved_total
  FROM public.exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id
    AND (eq.status='approved' OR eq.qc_status='approved' OR eq.review_state='approved');

  SELECT count(*) INTO v_hardish_count
  FROM public.exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id
    AND (eq.status='approved' OR eq.qc_status='approved' OR eq.review_state='approved')
    AND eq.difficulty = 'hard'
    AND eq.cognitive_level IN ('apply','analyze','evaluate','create');

  v_hardish_pct := CASE WHEN v_approved_total > 0
    THEN (v_hardish_count::numeric * 100 / v_approved_total) ELSE 0 END;

  SELECT count(*) INTO v_total_blueprints
  FROM public.question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';

  IF array_length(v_lf_missing, 1) > 0 THEN
    v_strategy := 'package_repair_exam_pool_lf_coverage';
    v_job_type := 'package_repair_exam_pool_lf_coverage';
    v_payload  := jsonb_build_object(
      'package_id', _package_id, 'curriculum_id', v_curriculum_id,
      'is_repair', true, 'mode', 'targeted_lf_fill',
      'target_lf_ids', to_jsonb(v_lf_missing),
      'continuation_of_targeted_fill', false, 'continuation_depth', 0,
      'source_cluster', 'REPAIR_LF_COVERAGE'
    );
    v_reason := format('lf_coverage_gap_%s_of_%s', array_length(v_lf_missing,1), v_total_lf);

  ELSIF array_length(v_competencies_missing_questions, 1) > 0 THEN
    IF v_total_blueprints = 0 THEN
      v_strategy := 'package_repair_exam_pool_lf_coverage';
      v_job_type := 'package_repair_exam_pool_lf_coverage';
      v_payload  := jsonb_build_object(
        'package_id', _package_id, 'curriculum_id', v_curriculum_id,
        'is_repair', true, 'mode', 'targeted_blueprint_fill',
        'target_competency_ids', to_jsonb(v_competencies_missing_questions),
        'continuation_of_targeted_fill', false, 'continuation_depth', 0,
        'source_cluster', 'REPAIR_COMPETENCY_COVERAGE'
      );
      v_reason := 'no_approved_question_blueprints';
    ELSE
      v_strategy := 'package_repair_exam_pool_competency_coverage';
      v_job_type := 'package_repair_exam_pool_competency_coverage';
      v_payload  := jsonb_build_object(
        'package_id', _package_id, 'curriculum_id', v_curriculum_id,
        'is_repair', true, 'mode', 'targeted_competency_fill',
        'target_competency_ids', to_jsonb(v_competencies_missing_questions),
        'continuation_of_targeted_fill', false, 'continuation_depth', 0,
        'source_cluster', 'REPAIR_COMPETENCY_COVERAGE'
      );
      v_reason := format('missing_min_questions_for_%s_competencies', array_length(v_competencies_missing_questions,1));
    END IF;

  ELSIF v_approved_total >= 50 AND v_hardish_pct < v_target_hardish_pct THEN
    -- FIX #3: targeted_difficulty_fill wird vom Edge-Handler aktuell nicht produktiv unterstützt
    -- → kein automatischer Job, sondern manual_review_required (verhindert No-Effect-Loop)
    v_strategy := 'manual_review_required';
    v_job_type := NULL;
    v_payload  := jsonb_build_object(
      'package_id', _package_id, 'curriculum_id', v_curriculum_id,
      'detected_gap', 'hardish_too_low',
      'current_hardish_pct', v_hardish_pct,
      'target_hardish_pct', v_target_hardish_pct,
      'recommended_action', 'manual_seed_or_implement_difficulty_fill_handler',
      'source_cluster', 'REPAIR_HARDISH_TOO_LOW'
    );
    v_reason := format('hardish_too_low_%s_pct_target_%s_pct_handler_not_implemented',
      round(v_hardish_pct,1), round(v_target_hardish_pct,0));

  ELSE
    v_strategy := 'no_action_no_deficit';
    v_job_type := NULL;
    v_payload  := '{}'::jsonb;
    v_reason   := format('all_gates_ok_approved=%s_lf=%s_comp=%s_hardish=%s',
      v_approved_total, v_total_lf, v_total_competencies, round(v_hardish_pct,1));
  END IF;

  RETURN jsonb_build_object(
    'strategy', v_strategy, 'job_type', v_job_type,
    'payload',  v_payload, 'reason',   v_reason,
    'target_competency_ids', to_jsonb(COALESCE(v_competencies_missing_questions,'{}'::uuid[])),
    'target_lf_ids',         to_jsonb(COALESCE(v_lf_missing,'{}'::uuid[])),
    'total_competencies',    v_total_competencies,
    'total_lf',              v_total_lf,
    'total_blueprints',      v_total_blueprints,
    'approved_questions',    v_approved_total,
    'hardish_pct',           v_hardish_pct,
    'target_hardish_pct',    v_target_hardish_pct
  );
END;
$function$;

-- Validator: targeted_difficulty_fill als deploy-blocker markieren, solange Handler fehlt
CREATE OR REPLACE FUNCTION public.admin_validate_repair_job_type(_job_type text, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text := _payload->>'mode';
  v_is_repair bool := COALESCE((_payload->>'is_repair')::bool, false);
  v_valid bool := true;
  v_warning text := NULL;
  v_severity text := 'info';
BEGIN
  IF _job_type = 'package_exam_rebalance' AND v_mode IN (
    'targeted_competency_fill','targeted_blueprint_fill','targeted_lf_fill','targeted_difficulty_fill'
  ) THEN
    v_valid := false; v_severity := 'high';
    v_warning := format('Rebalance darf keine Coverage-Lücken reparieren (mode=%s). Erwartet: package_repair_exam_pool_*', v_mode);
    RETURN jsonb_build_object('valid',v_valid,'warning',v_warning,'severity',v_severity,'job_type',_job_type,'mode',v_mode);
  END IF;

  IF v_mode = 'targeted_blueprint_fill' THEN
    IF _job_type <> 'package_repair_exam_pool_lf_coverage' THEN
      v_valid := false; v_severity := 'high';
      v_warning := format('Blueprint-Fill-Mode (%s) verwendet falschen job_type %s. Erwartet: package_repair_exam_pool_lf_coverage', v_mode, _job_type);
    END IF;
  ELSIF v_mode = 'targeted_competency_fill' THEN
    IF _job_type <> 'package_repair_exam_pool_competency_coverage' THEN
      v_valid := false; v_severity := 'high';
      v_warning := format('Competency-Fill-Mode (%s) verwendet falschen job_type %s. Erwartet: package_repair_exam_pool_competency_coverage', v_mode, _job_type);
    END IF;
  ELSIF v_mode = 'targeted_lf_fill' THEN
    IF _job_type <> 'package_repair_exam_pool_lf_coverage' THEN
      v_valid := false; v_severity := 'high';
      v_warning := format('LF-Fill-Mode (%s) verwendet falschen job_type %s. Erwartet: package_repair_exam_pool_lf_coverage', v_mode, _job_type);
    END IF;
  ELSIF v_mode = 'targeted_difficulty_fill' THEN
    -- Aktuell als deploy-blocker: package-repair-exam-pool-quality ignoriert diesen Mode
    v_valid := false; v_severity := 'high';
    v_warning := 'targeted_difficulty_fill ist nicht produktionsbereit (Edge-Handler unterstützt Mode noch nicht). Bitte manual_review_required verwenden oder dedizierten Handler implementieren.';
  ELSIF v_is_repair AND v_mode IS NULL THEN
    v_valid := false; v_severity := 'medium';
    v_warning := format('Repair-Job %s ohne mode-Flag im Payload', _job_type);
  END IF;

  RETURN jsonb_build_object('valid',v_valid,'warning',v_warning,'severity',v_severity,'job_type',_job_type,'mode',v_mode);
END;
$function$;