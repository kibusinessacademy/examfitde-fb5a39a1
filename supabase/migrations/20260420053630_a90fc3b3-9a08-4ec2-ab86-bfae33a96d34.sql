CREATE OR REPLACE FUNCTION public.fn_prebuild_promote_blueprint_variants(p_package_id uuid)
 RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_curriculum_id uuid;
  v_certification_id uuid;
  v_existing_eq int := 0;
  v_total_variants int := 0;
  v_inserted int := 0;
  v_collisions int := 0;
  v_trigger_blocked int := 0;
  v_skipped_existing int := 0;
  v_top_per_lf int := 6;
  v_variant RECORD;
  v_reason text;
  v_is_trap boolean;
BEGIN
  SELECT cp.curriculum_id, cp.certification_id
  INTO v_curriculum_id, v_certification_id
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'NO_CURRICULUM'::text,
      jsonb_build_object('package_id', p_package_id);
    RETURN;
  END IF;

  SELECT count(*) INTO v_existing_eq
  FROM exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id;

  SELECT count(*) INTO v_total_variants
  FROM exam_question_variants eqv
  WHERE eqv.curriculum_id = v_curriculum_id
    AND eqv.status IN ('review','approved')
    AND eqv.question_text IS NOT NULL
    AND length(eqv.question_text) > 20
    AND eqv.learning_field_id IS NOT NULL
    AND eqv.blueprint_id IS NOT NULL;

  IF v_existing_eq = 0 AND v_total_variants >= 6 THEN
    FOR v_variant IN
      WITH ranked AS (
        SELECT *
        FROM (
          SELECT DISTINCT ON (eqv.blueprint_id, md5(eqv.question_text))
            eqv.*,
            ROW_NUMBER() OVER (
              PARTITION BY eqv.learning_field_id
              ORDER BY COALESCE(eqv.quality_score, 0) DESC NULLS LAST, eqv.created_at ASC
            ) AS rk
          FROM exam_question_variants eqv
          WHERE eqv.curriculum_id = v_curriculum_id
            AND eqv.status IN ('review','approved')
            AND eqv.question_text IS NOT NULL
            AND length(eqv.question_text) > 20
            AND eqv.learning_field_id IS NOT NULL
            AND eqv.blueprint_id IS NOT NULL
          ORDER BY eqv.blueprint_id, md5(eqv.question_text),
                   COALESCE(eqv.quality_score, 0) DESC NULLS LAST, eqv.created_at ASC
        ) s
        WHERE s.rk <= v_top_per_lf
      )
      SELECT * FROM ranked
    LOOP
      IF EXISTS (
        SELECT 1 FROM exam_questions eq2
        WHERE eq2.meta->>'source_variant_id' = v_variant.id::text
      ) THEN
        v_skipped_existing := v_skipped_existing + 1;
        CONTINUE;
      END IF;

      v_is_trap := v_variant.trap_type IS NOT NULL AND length(trim(v_variant.trap_type)) > 0;

      BEGIN
        INSERT INTO exam_questions (
          curriculum_id, learning_field_id, competency_id,
          question_text, options, correct_answer, explanation,
          difficulty, status, ai_generated, blueprint_id, normalized_hash,
          cognitive_level, question_type, is_trap, meta, certification_id
        )
        VALUES (
          v_variant.curriculum_id, v_variant.learning_field_id, v_variant.competency_id,
          v_variant.question_text,
          COALESCE(v_variant.options, '[]'::jsonb),
          CASE
            WHEN v_variant.correct_answer IS NULL THEN 0
            WHEN jsonb_typeof(v_variant.correct_answer) = 'number' THEN
              GREATEST(0, FLOOR((v_variant.correct_answer)::text::numeric)::int)
            WHEN jsonb_typeof(v_variant.correct_answer) = 'string'
                 AND (v_variant.correct_answer #>> '{}') ~ '^[0-9]+$' THEN
              (v_variant.correct_answer #>> '{}')::int
            ELSE 0
          END,
          v_variant.answer_text,
          'medium'::question_difficulty,
          'approved'::question_status,
          true,
          v_variant.blueprint_id,
          md5(v_variant.question_text),
          v_variant.cognitive_level,
          CASE
            WHEN v_variant.question_type IN ('concept','procedure','calculation','case_study','transfer') THEN v_variant.question_type
            WHEN v_variant.question_type IN ('mc_single','mc_multi','true_false','short_answer') THEN 'concept'
            WHEN v_variant.question_type IN ('regulation','scenario') THEN 'case_study'
            WHEN v_variant.question_type IN ('oral_question','oral_prompt') THEN 'transfer'
            ELSE 'concept'
          END,
          v_is_trap,
          jsonb_build_object(
            'source_variant_id', v_variant.id,
            'promoted_at', v_now,
            'quality_score', v_variant.quality_score,
            'original_question_type', v_variant.question_type,
            'promoted_by', 'fn_prebuild_promote_blueprint_variants_v3',
            'rank_in_lf', v_variant.rk
          ),
          v_certification_id
        )
        ON CONFLICT (blueprint_id, normalized_hash)
        WHERE blueprint_id IS NOT NULL AND normalized_hash IS NOT NULL
        DO NOTHING;

        IF FOUND THEN
          v_inserted := v_inserted + 1;
        ELSE
          v_collisions := v_collisions + 1;
        END IF;
      EXCEPTION
        WHEN unique_violation THEN
          v_collisions := v_collisions + 1;
          CONTINUE;
        WHEN check_violation THEN
          v_trigger_blocked := v_trigger_blocked + 1;
          CONTINUE;
        WHEN raise_exception THEN
          v_trigger_blocked := v_trigger_blocked + 1;
          CONTINUE;
        WHEN OTHERS THEN
          IF SQLERRM ILIKE '%GLOBAL_CANONICAL_COLLISION%'
             OR SQLERRM ILIKE '%canonical%collision%'
             OR SQLERRM ILIKE '%collision%'
             OR SQLERRM ILIKE '%duplicate%'
             OR SQLERRM ILIKE '%APPROVAL_REQUIRES_%'
             OR SQLERRM ILIKE '%approval_requires_trap_type%'
             OR SQLERRM ILIKE '%trap_type%' THEN
            v_trigger_blocked := v_trigger_blocked + 1;
            CONTINUE;
          ELSE
            RAISE;
          END IF;
      END;
    END LOOP;

    UPDATE exam_question_variants eqv
    SET status = 'approved', updated_at = v_now
    WHERE eqv.curriculum_id = v_curriculum_id
      AND eqv.status = 'review'
      AND EXISTS (
        SELECT 1 FROM exam_questions eq3
        WHERE eq3.meta->>'source_variant_id' = eqv.id::text
      );
  END IF;

  SELECT count(*) INTO v_existing_eq
  FROM exam_questions eq WHERE eq.curriculum_id = v_curriculum_id;

  IF v_existing_eq = 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_VARIANTS_MATERIALIZED'::text,
      jsonb_build_object(
        'total_variants', v_total_variants,
        'inserted', v_inserted,
        'collisions', v_collisions,
        'trigger_blocked_skipped', v_trigger_blocked,
        'skipped_existing', v_skipped_existing
      );
    RETURN;
  END IF;

  UPDATE package_steps ps
  SET status = 'done',
      started_at = COALESCE(ps.started_at, v_now),
      finished_at = v_now,
      updated_at = v_now,
      meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
        'ok', true, 'executed', true, 'prebuild', true,
        'adopted', true, 'adopted_from_ssot', true,
        'prebuild_fn', 'fn_prebuild_promote_blueprint_variants',
        'strategy', 'top_n_per_lf_row_tolerant_v3',
        'top_n', v_top_per_lf,
        'inserted_questions', v_inserted,
        'collisions_skipped', v_collisions,
        'trigger_blocked_skipped', v_trigger_blocked,
        'skipped_existing', v_skipped_existing,
        'exam_questions_total', v_existing_eq,
        'checked_at', v_now
      )
  WHERE ps.package_id = p_package_id
    AND ps.step_key = 'promote_blueprint_variants'
    AND ps.status <> 'done';

  v_reason := CASE
    WHEN v_inserted > 0 THEN 'ADOPTED_VIA_ROW_TOLERANT_BRIDGE'
    WHEN v_existing_eq > 0 THEN 'ARTIFACT_TRUTH_ADOPTED_WITH_COLLISIONS'
    ELSE 'ADOPTED'
  END;

  RETURN QUERY SELECT 'done'::text, true, v_reason,
    jsonb_build_object(
      'inserted', v_inserted,
      'collisions_skipped', v_collisions,
      'trigger_blocked_skipped', v_trigger_blocked,
      'skipped_existing', v_skipped_existing,
      'exam_questions_total', v_existing_eq
    );
END;
$function$;