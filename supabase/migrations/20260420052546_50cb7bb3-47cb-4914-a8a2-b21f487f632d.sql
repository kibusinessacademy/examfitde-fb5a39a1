-- Wave 14b: Bridge-Härtung
CREATE OR REPLACE FUNCTION public.fn_prebuild_generate_blueprint_variants(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_curriculum_id uuid;
  v_step_status text;
  v_total_bp int := 0;
  v_with_variants int := 0;
  v_inserted int := 0;
  v_collisions int := 0;
  v_skipped_invalid int := 0;
  v_pct numeric := 0;
  v_bp RECORD;
  v_variant_text text;
  v_q_type text;
  v_lf_id uuid;
  v_comp_id uuid;
  v_fallback_lf uuid;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'NO_CURRICULUM'::text,
      jsonb_build_object('package_id', p_package_id);
    RETURN;
  END IF;

  SELECT ps.status INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'generate_blueprint_variants';

  IF v_step_status IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'STEP_MISSING'::text, '{}'::jsonb;
    RETURN;
  END IF;

  IF v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE'::text, '{}'::jsonb;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_total_bp
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';

  IF v_total_bp = 0 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'NO_APPROVED_BLUEPRINTS'::text,
      jsonb_build_object('total_bp', 0, 'class', 'A_NO_BLUEPRINTS');
    RETURN;
  END IF;

  -- Fallback-LF des Curriculums für Blueprints ohne LF
  SELECT lf.id INTO v_fallback_lf
  FROM learning_fields lf
  WHERE lf.curriculum_id = v_curriculum_id
  ORDER BY lf.order_index NULLS LAST, lf.created_at
  LIMIT 1;

  FOR v_bp IN
    SELECT qb.id, qb.curriculum_id, qb.learning_field_id, qb.competency_id,
           qb.question_template, qb.explanation_template, qb.allowed_question_types,
           qb.cognitive_level, qb.canonical_statement
    FROM question_blueprints qb
    WHERE qb.curriculum_id = v_curriculum_id
      AND qb.status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM exam_question_variants eqv
        WHERE eqv.blueprint_id = qb.id
      )
  LOOP
    v_variant_text := COALESCE(NULLIF(trim(v_bp.question_template), ''), v_bp.canonical_statement);

    IF v_variant_text IS NULL OR length(v_variant_text) < 10 THEN
      v_skipped_invalid := v_skipped_invalid + 1;
      CONTINUE;
    END IF;

    -- LF-Resolution-Kette: blueprint.lf → competency.lf → curriculum-fallback
    v_lf_id := v_bp.learning_field_id;
    v_comp_id := v_bp.competency_id;
    IF v_lf_id IS NULL AND v_comp_id IS NOT NULL THEN
      SELECT c.learning_field_id INTO v_lf_id FROM competencies c WHERE c.id = v_comp_id;
    END IF;
    IF v_lf_id IS NULL THEN
      v_lf_id := v_fallback_lf;
    END IF;

    v_q_type := COALESCE(
      (CASE
        WHEN v_bp.allowed_question_types IS NOT NULL
             AND array_length(v_bp.allowed_question_types, 1) >= 1
        THEN (v_bp.allowed_question_types)[1]::text
        ELSE 'concept'
      END),
      'concept'
    );
    v_q_type := CASE
      WHEN v_q_type IN ('concept','procedure','calculation','case_study','transfer') THEN v_q_type
      WHEN v_q_type IN ('mc_single','mc_multi','true_false','short_answer') THEN 'concept'
      WHEN v_q_type IN ('regulation','scenario') THEN 'case_study'
      ELSE 'concept'
    END;

    BEGIN
      INSERT INTO exam_question_variants (
        blueprint_id, curriculum_id, learning_field_id, competency_id,
        variant_type, question_type, cognitive_level,
        question_text, answer_text, options, correct_answer,
        quality_score, status, created_at, updated_at
      ) VALUES (
        v_bp.id, v_bp.curriculum_id, v_lf_id, v_comp_id,
        'parameter_shift', v_q_type,
        COALESCE(v_bp.cognitive_level::text, 'apply'),
        v_variant_text,
        COALESCE(NULLIF(trim(v_bp.explanation_template), ''), 'Siehe Lernfeld-Erläuterung.'),
        '[]'::jsonb,
        '0'::jsonb,
        50, 'review', v_now, v_now
      );
      v_inserted := v_inserted + 1;
    EXCEPTION
      WHEN check_violation OR unique_violation THEN
        v_collisions := v_collisions + 1;
        CONTINUE;
      WHEN OTHERS THEN
        IF SQLERRM ILIKE '%collision%' OR SQLERRM ILIKE '%duplicate%' THEN
          v_collisions := v_collisions + 1;
          CONTINUE;
        ELSE
          RAISE;
        END IF;
    END;
  END LOOP;

  SELECT COUNT(DISTINCT qb.id) INTO v_with_variants
  FROM question_blueprints qb
  JOIN exam_question_variants eqv ON eqv.blueprint_id = qb.id
  WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';

  v_pct := (v_with_variants::numeric / NULLIF(v_total_bp,0)::numeric) * 100;

  IF v_pct < 80 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'INSUFFICIENT_VARIANT_COVERAGE'::text,
      jsonb_build_object(
        'total_bp', v_total_bp, 'with_variants', v_with_variants, 'coverage_pct', v_pct,
        'inserted', v_inserted, 'collisions_skipped', v_collisions, 'skipped_invalid', v_skipped_invalid
      );
    RETURN;
  END IF;

  UPDATE package_steps ps
  SET status = 'done',
      started_at = COALESCE(ps.started_at, v_now),
      finished_at = v_now,
      updated_at = v_now,
      meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
        'ok', true, 'executed', true, 'prebuild', true, 'adopted', true,
        'adopted_from_ssot', true,
        'prebuild_fn', 'fn_prebuild_generate_blueprint_variants',
        'strategy', 'row_tolerant_bridge_v1b_lf_fallback',
        'total_blueprints', v_total_bp,
        'with_variants', v_with_variants,
        'coverage_pct', v_pct,
        'inserted_variants', v_inserted,
        'collisions_skipped', v_collisions,
        'skipped_invalid', v_skipped_invalid,
        'checked_at', v_now
      )
  WHERE ps.package_id = p_package_id
    AND ps.step_key = 'generate_blueprint_variants'
    AND ps.status <> 'done';

  RETURN QUERY SELECT 'done'::text, true,
    CASE WHEN v_inserted > 0 THEN 'ADOPTED_VIA_GENERATE_BRIDGE' ELSE 'ARTIFACT_TRUTH_ADOPTED' END,
    jsonb_build_object(
      'inserted_variants', v_inserted,
      'collisions_skipped', v_collisions,
      'skipped_invalid', v_skipped_invalid,
      'coverage_pct', v_pct,
      'with_variants', v_with_variants,
      'total_bp', v_total_bp
    );
END;
$function$;

-- Promote-Bridge: erweitere Exception-Handling um Trigger-RAISE
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

      -- is_trap nur dann, wenn trap_type wirklich gesetzt ist
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
            'promoted_by', 'fn_prebuild_promote_blueprint_variants_v2',
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
        WHEN raise_exception THEN
          -- Trigger-Aborts (z.B. APPROVAL_REQUIRES_TRAP_TYPE) tolerieren
          v_trigger_blocked := v_trigger_blocked + 1;
          CONTINUE;
        WHEN OTHERS THEN
          IF SQLERRM ILIKE '%GLOBAL_CANONICAL_COLLISION%'
             OR SQLERRM ILIKE '%collision%'
             OR SQLERRM ILIKE '%duplicate%'
             OR SQLERRM ILIKE '%APPROVAL_REQUIRES_%'
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
        'total_variants', v_total_variants, 'inserted', v_inserted,
        'collisions', v_collisions, 'trigger_blocked', v_trigger_blocked,
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
        'strategy', 'top_n_per_lf_row_tolerant_v2',
        'top_n', v_top_per_lf,
        'inserted_questions', v_inserted,
        'collisions_skipped', v_collisions,
        'trigger_blocked', v_trigger_blocked,
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
      'trigger_blocked', v_trigger_blocked,
      'skipped_existing', v_skipped_existing,
      'exam_questions_total', v_existing_eq
    );
END;
$function$;