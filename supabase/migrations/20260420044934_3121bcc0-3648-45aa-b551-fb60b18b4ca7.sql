
-- ════════════════════════════════════════════════════════════════════
-- Wave 13b: Promote-Bridge Härtung
-- Bug: (ranked.correct_answer)::text::int crasht bei "0" / Strings
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_prebuild_promote_blueprint_variants(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid; v_step_status text; v_now timestamptz := now();
  v_existing_eq int; v_total_variants int; v_inserted int := 0; v_top_per_lf int := 10;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id = p_package_id;
  IF v_curriculum_id IS NULL THEN RETURN QUERY SELECT 'noop'::text, false, 'NO_CURRICULUM'::text, '{}'::jsonb; RETURN; END IF;

  SELECT ps.status INTO v_step_status FROM package_steps ps
   WHERE ps.package_id = p_package_id AND ps.step_key = 'promote_blueprint_variants';
  IF v_step_status IS NULL OR v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE_OR_MISSING'::text, '{}'::jsonb; RETURN; END IF;

  SELECT count(*) INTO v_existing_eq FROM exam_questions eq WHERE eq.curriculum_id = v_curriculum_id;
  SELECT count(*) INTO v_total_variants FROM exam_question_variants eqv
   WHERE eqv.curriculum_id = v_curriculum_id AND eqv.status IN ('review','approved');

  IF v_existing_eq = 0 AND v_total_variants >= 6 THEN
    INSERT INTO exam_questions (
      curriculum_id, learning_field_id, competency_id, question_text, options, correct_answer, explanation,
      difficulty, status, ai_generated, blueprint_id, normalized_hash,
      cognitive_level, question_type, is_trap, meta, certification_id)
    SELECT
      ranked.curriculum_id, ranked.learning_field_id, ranked.competency_id, ranked.question_text,
      COALESCE(ranked.options, '[]'::jsonb),
      -- HARDENED: robust int extraction
      CASE
        WHEN ranked.correct_answer IS NULL THEN 0
        WHEN jsonb_typeof(ranked.correct_answer) = 'number' THEN
          GREATEST(0, FLOOR((ranked.correct_answer)::text::numeric)::int)
        WHEN jsonb_typeof(ranked.correct_answer) = 'string'
             AND (ranked.correct_answer #>> '{}') ~ '^[0-9]+$' THEN
          ((ranked.correct_answer #>> '{}')::int)
        ELSE 0
      END,
      ranked.answer_text, 'medium'::question_difficulty, 'approved'::question_status, true,
      ranked.blueprint_id, md5(ranked.question_text), ranked.cognitive_level,
      CASE
        WHEN ranked.question_type IN ('concept','procedure','calculation','case_study','transfer') THEN ranked.question_type
        WHEN ranked.question_type IN ('mc_single','mc_multi','true_false','short_answer') THEN 'concept'
        WHEN ranked.question_type IN ('regulation','scenario') THEN 'case_study'
        WHEN ranked.question_type IN ('oral_question','oral_prompt') THEN 'transfer'
        ELSE 'concept' END,
      COALESCE(ranked.trap_type IS NOT NULL, false),
      jsonb_build_object('source_variant_id', ranked.id, 'promoted_at', v_now::text,
        'quality_score', ranked.quality_score, 'original_question_type', ranked.question_type,
        'promoted_by', 'fn_prebuild_promote_blueprint_variants_topn_v2', 'rank_in_lf', ranked.rk),
      (SELECT cp2.certification_id FROM course_packages cp2 WHERE cp2.id = p_package_id)
    FROM (
      SELECT DISTINCT ON (eqv.blueprint_id, md5(eqv.question_text)) eqv.*,
        ROW_NUMBER() OVER (PARTITION BY eqv.learning_field_id
          ORDER BY COALESCE(eqv.quality_score, 0) DESC NULLS LAST, eqv.created_at ASC) AS rk
      FROM exam_question_variants eqv
      WHERE eqv.curriculum_id = v_curriculum_id
        AND eqv.status IN ('review','approved')
        AND eqv.question_text IS NOT NULL AND length(eqv.question_text) > 20
        AND eqv.learning_field_id IS NOT NULL AND eqv.blueprint_id IS NOT NULL
      ORDER BY eqv.blueprint_id, md5(eqv.question_text), COALESCE(eqv.quality_score, 0) DESC NULLS LAST, eqv.created_at ASC
    ) ranked
    WHERE ranked.rk <= v_top_per_lf
      AND NOT EXISTS (SELECT 1 FROM exam_questions eq2 WHERE eq2.meta->>'source_variant_id' = ranked.id::text)
    ON CONFLICT (blueprint_id, normalized_hash) WHERE blueprint_id IS NOT NULL AND normalized_hash IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    UPDATE exam_question_variants eqv SET status = 'approved', updated_at = v_now
    WHERE eqv.curriculum_id = v_curriculum_id AND eqv.status = 'review'
      AND EXISTS (SELECT 1 FROM exam_questions eq3 WHERE eq3.meta->>'source_variant_id' = eqv.id::text);
  END IF;

  SELECT count(*) INTO v_existing_eq FROM exam_questions eq WHERE eq.curriculum_id = v_curriculum_id;

  IF v_existing_eq = 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_VARIANTS_AVAILABLE'::text,
      jsonb_build_object('total_variants', v_total_variants, 'inserted', v_inserted); RETURN;
  END IF;

  UPDATE package_steps ps SET status = 'done',
    started_at = COALESCE(ps.started_at, v_now), finished_at = v_now,
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'ok', true, 'executed', true, 'prebuild', true, 'adopted', true,
      'adopted_from_ssot', true, 'inserted_questions', v_inserted,
      'total_variants_seen', v_total_variants, 'adopted_at', v_now,
      'adopted_by', 'fn_prebuild_promote_blueprint_variants_v2')
  WHERE ps.package_id = p_package_id AND ps.step_key = 'promote_blueprint_variants' AND ps.status != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'ADOPTED_VIA_TOPN_BRIDGE'::text,
    jsonb_build_object('inserted', v_inserted, 'existing_after', v_existing_eq, 'total_variants', v_total_variants);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- Wave 13b: Heal-Function für RETURNS TABLE Konsumieren
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_heal_remaining_packages_by_class()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg RECORD;
  v_promote_row RECORD;
  v_class_d_healed int := 0;
  v_class_d_skipped int := 0;
  v_class_d_failed int := 0;
  v_class_b_triggered int := 0;
  v_class_a_triggered int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_details jsonb := '[]'::jsonb;
BEGIN
  -- ─── Klasse D ───
  FOR v_pkg IN
    SELECT cp.id AS package_id, cp.curriculum_id, cp.title
    FROM course_packages cp
    WHERE cp.status NOT IN ('archived','draft','retired')
      AND NOT EXISTS (SELECT 1 FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id)
      AND EXISTS (
        SELECT 1 FROM exam_question_variants eqv
        WHERE eqv.curriculum_id = cp.curriculum_id AND eqv.status IN ('review','approved'))
  LOOP
    BEGIN
      SELECT * INTO v_promote_row
      FROM fn_prebuild_promote_blueprint_variants(v_pkg.package_id) LIMIT 1;

      IF v_promote_row.advanced = true THEN
        v_class_d_healed := v_class_d_healed + 1;
        v_details := v_details || jsonb_build_object(
          'class','D','package_id',v_pkg.package_id,'title',v_pkg.title,
          'reason',v_promote_row.reason,'meta',v_promote_row.meta);
      ELSE
        v_class_d_skipped := v_class_d_skipped + 1;
        v_details := v_details || jsonb_build_object(
          'class','D','package_id',v_pkg.package_id,'title',v_pkg.title,
          'skipped',true,'reason',v_promote_row.reason,'meta',v_promote_row.meta);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Catch GLOBAL_CANONICAL_COLLISION etc.
      v_class_d_failed := v_class_d_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'class','D','package_id',v_pkg.package_id,'title',v_pkg.title,
        'sqlstate',SQLSTATE,'error',SQLERRM);
    END;
  END LOOP;

  -- ─── Klasse B ───
  FOR v_pkg IN
    SELECT cp.id AS package_id, cp.curriculum_id, cp.title
    FROM course_packages cp
    WHERE cp.status NOT IN ('archived','draft','retired')
      AND NOT EXISTS (SELECT 1 FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id)
      AND NOT EXISTS (SELECT 1 FROM exam_question_variants eqv WHERE eqv.curriculum_id = cp.curriculum_id)
      AND (SELECT COUNT(*) FROM question_blueprints qb WHERE qb.curriculum_id = cp.curriculum_id AND qb.status='approved') >= 10
  LOOP
    BEGIN
      UPDATE package_steps ps
      SET status = 'queued', started_at = NULL, finished_at = NULL,
          meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
            'requeued_by','wave13_class_b','requeued_at', now())
      WHERE ps.package_id = v_pkg.package_id
        AND ps.step_key = 'generate_blueprint_variants'
        AND ps.status NOT IN ('done');
      v_class_b_triggered := v_class_b_triggered + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('class','B','package_id',v_pkg.package_id,'error',SQLERRM);
    END;
  END LOOP;

  -- ─── Klasse A ───
  FOR v_pkg IN
    SELECT cp.id AS package_id, cp.curriculum_id, cp.title
    FROM course_packages cp
    WHERE cp.status NOT IN ('archived','draft','retired')
      AND NOT EXISTS (SELECT 1 FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id)
      AND NOT EXISTS (SELECT 1 FROM exam_question_variants eqv WHERE eqv.curriculum_id = cp.curriculum_id)
      AND (SELECT COUNT(*) FROM question_blueprints qb WHERE qb.curriculum_id = cp.curriculum_id AND qb.status='approved') = 0
  LOOP
    BEGIN
      UPDATE package_steps ps
      SET status = 'queued', started_at = NULL, finished_at = NULL,
          meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
            'requeued_by','wave13_class_a','requeued_at', now(),
            'reason','source_gap_no_blueprints')
      WHERE ps.package_id = v_pkg.package_id
        AND ps.step_key IN ('auto_seed_exam_blueprints','generate_exam_pool')
        AND ps.status NOT IN ('done','running');
      v_class_a_triggered := v_class_a_triggered + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('class','A','package_id',v_pkg.package_id,'error',SQLERRM);
    END;
  END LOOP;

  INSERT INTO admin_actions (action, scope, payload)
  VALUES ('wave13_class_specific_heal_v2','system',
    jsonb_build_object(
      'class_d_healed', v_class_d_healed,
      'class_d_skipped', v_class_d_skipped,
      'class_d_failed', v_class_d_failed,
      'class_b_triggered', v_class_b_triggered,
      'class_a_triggered', v_class_a_triggered,
      'error_count', jsonb_array_length(v_errors),
      'errors', v_errors,
      'executed_at', now()));

  RETURN jsonb_build_object('ok', true,
    'class_d_healed', v_class_d_healed,
    'class_d_skipped', v_class_d_skipped,
    'class_d_failed', v_class_d_failed,
    'class_b_triggered', v_class_b_triggered,
    'class_a_triggered', v_class_a_triggered,
    'error_count', jsonb_array_length(v_errors),
    'errors', v_errors);
END;
$$;
