-- Wave 14: Generate-Bridge für exam_question_variants
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

  -- Materialisierung: für jeden Blueprint ohne Variante mind. 1 parameter_shift
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

    -- Skip invalid sources
    IF v_variant_text IS NULL OR length(v_variant_text) < 10 THEN
      v_skipped_invalid := v_skipped_invalid + 1;
      CONTINUE;
    END IF;

    -- Map allowed_question_types[1] auf gültigen variant question_type
    v_q_type := COALESCE(
      (CASE
        WHEN v_bp.allowed_question_types IS NOT NULL
             AND array_length(v_bp.allowed_question_types, 1) >= 1
        THEN (v_bp.allowed_question_types)[1]::text
        ELSE 'concept'
      END),
      'concept'
    );
    -- Domain-Mapping (gleiche Logik wie Promote-Bridge in Reverse)
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
        v_bp.id, v_bp.curriculum_id, v_bp.learning_field_id, v_bp.competency_id,
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

  -- Coverage neu berechnen
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
        'strategy', 'row_tolerant_bridge_v1',
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

-- Sweep helper für Wave 14
CREATE OR REPLACE FUNCTION public.fn_run_generate_bridge_sweep(p_limit int DEFAULT 50)
RETURNS TABLE(package_id uuid, title text, step_status text, reason text, meta jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg RECORD;
  v_res RECORD;
BEGIN
  FOR v_pkg IN
    SELECT cp.id, cp.title
    FROM course_packages cp
    JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'generate_blueprint_variants'
    WHERE cp.status NOT IN ('archived','draft','retired')
      AND ps.status <> 'done'
      AND EXISTS (
        SELECT 1 FROM question_blueprints qb
        WHERE qb.curriculum_id = cp.curriculum_id AND qb.status = 'approved'
      )
    ORDER BY cp.title
    LIMIT p_limit
  LOOP
    BEGIN
      SELECT * INTO v_res FROM public.fn_prebuild_generate_blueprint_variants(v_pkg.id) LIMIT 1;
      package_id := v_pkg.id;
      title := v_pkg.title;
      step_status := v_res.step_status;
      reason := v_res.reason;
      meta := v_res.meta;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      package_id := v_pkg.id;
      title := v_pkg.title;
      step_status := 'error';
      reason := SQLERRM;
      meta := '{}'::jsonb;
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$;