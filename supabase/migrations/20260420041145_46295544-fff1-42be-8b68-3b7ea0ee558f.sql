CREATE OR REPLACE FUNCTION public.fn_prebuild_promote_blueprint_variants(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid;
  v_step_status text;
  v_now timestamptz := now();
  v_existing_eq int;
  v_total_variants int;
  v_inserted int := 0;
  v_top_per_lf int := 10;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id = p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'NO_CURRICULUM'::text, '{}'::jsonb; RETURN;
  END IF;

  SELECT ps.status INTO v_step_status FROM package_steps ps
   WHERE ps.package_id = p_package_id AND ps.step_key = 'promote_blueprint_variants';
  IF v_step_status IS NULL OR v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE_OR_MISSING'::text, '{}'::jsonb; RETURN;
  END IF;

  SELECT count(*) INTO v_existing_eq FROM exam_questions eq WHERE eq.curriculum_id = v_curriculum_id;
  SELECT count(*) INTO v_total_variants FROM exam_question_variants eqv
   WHERE eqv.curriculum_id = v_curriculum_id AND eqv.status IN ('review','approved','promoted');

  -- BRIDGE: Top-N per Learning Field (no quality threshold)
  IF v_existing_eq = 0 AND v_total_variants >= 6 THEN
    INSERT INTO exam_questions (
      curriculum_id, learning_field_id, competency_id,
      question_text, options, correct_answer, explanation,
      difficulty, status, ai_generated, blueprint_id,
      cognitive_level, question_type, is_trap,
      meta, certification_id
    )
    SELECT
      ranked.curriculum_id, ranked.learning_field_id, ranked.competency_id,
      ranked.question_text,
      COALESCE(ranked.options, '[]'::jsonb),
      COALESCE(
        CASE WHEN jsonb_typeof(ranked.correct_answer) = 'number'
             THEN (ranked.correct_answer)::text::int
             ELSE 0 END,
        0
      ),
      ranked.answer_text,
      'medium'::question_difficulty,
      'approved'::question_status,
      true,
      ranked.blueprint_id,
      ranked.cognitive_level,
      COALESCE(ranked.question_type, 'mc_single'),
      COALESCE(ranked.trap_type IS NOT NULL, false),
      jsonb_build_object(
        'source_variant_id', ranked.id,
        'promoted_at', v_now::text,
        'quality_score', ranked.quality_score,
        'promoted_by', 'fn_prebuild_promote_blueprint_variants_topn',
        'rank_in_lf', ranked.rk
      ),
      (SELECT cp2.certification_id FROM course_packages cp2 WHERE cp2.id = p_package_id)
    FROM (
      SELECT eqv.*,
        ROW_NUMBER() OVER (
          PARTITION BY eqv.learning_field_id
          ORDER BY COALESCE(eqv.quality_score, 0) DESC NULLS LAST, eqv.created_at ASC
        ) AS rk
      FROM exam_question_variants eqv
      WHERE eqv.curriculum_id = v_curriculum_id
        AND eqv.status IN ('review','approved','promoted')
        AND eqv.question_text IS NOT NULL
        AND length(eqv.question_text) > 20
        AND eqv.learning_field_id IS NOT NULL
    ) ranked
    WHERE ranked.rk <= v_top_per_lf
      AND NOT EXISTS (
        SELECT 1 FROM exam_questions eq2
        WHERE eq2.meta->>'source_variant_id' = ranked.id::text
      );
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- Mark promoted source variants
    UPDATE exam_question_variants eqv
    SET status = 'promoted', updated_at = v_now
    WHERE eqv.curriculum_id = v_curriculum_id
      AND eqv.status IN ('review','approved')
      AND EXISTS (SELECT 1 FROM exam_questions eq3 WHERE eq3.meta->>'source_variant_id' = eqv.id::text);
  END IF;

  SELECT count(*) INTO v_existing_eq FROM exam_questions eq WHERE eq.curriculum_id = v_curriculum_id;

  IF v_existing_eq = 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_VARIANTS_AVAILABLE'::text,
      jsonb_build_object('total_variants', v_total_variants, 'inserted', v_inserted);
    RETURN;
  END IF;

  UPDATE package_steps ps SET
    status = 'done',
    started_at = COALESCE(ps.started_at, v_now),
    finished_at = v_now,
    updated_at = v_now,
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'ok', true, 'executed', true,
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_promote_blueprint_variants',
      'adopted', true, 'adopted_from_ssot', true,
      'bridge_inserted', v_inserted,
      'exam_questions_total', v_existing_eq,
      'strategy', 'top_n_per_lf',
      'top_n', v_top_per_lf,
      'checked_at', v_now::text
    )
  WHERE ps.package_id = p_package_id AND ps.step_key = 'promote_blueprint_variants' AND ps.status != 'done';

  RETURN QUERY SELECT 'done'::text, true,
    CASE WHEN v_inserted > 0 THEN 'BRIDGE_TOP_N_MATERIALIZED' ELSE 'ARTIFACT_TRUTH_ADOPTED' END,
    jsonb_build_object('inserted', v_inserted, 'exam_questions', v_existing_eq);
END;
$function$;