-- ============================================================
-- WAVE 12a: Promote-Bridge erweitert (Variants → exam_questions)
-- ============================================================
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
  v_promotable_count int;
  v_existing_eq int;
  v_inserted int := 0;
  v_quality_threshold numeric := 0.8;
  v_min_per_lf int := 6;
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

  -- Count promotable variants (quality + state)
  SELECT count(*) INTO v_promotable_count
  FROM exam_question_variants eqv
  WHERE eqv.curriculum_id = v_curriculum_id
    AND eqv.status IN ('review', 'approved', 'promoted')
    AND COALESCE(eqv.quality_score, 0) >= v_quality_threshold;

  SELECT count(*) INTO v_existing_eq FROM exam_questions eq WHERE eq.curriculum_id = v_curriculum_id;

  -- BRIDGE: Materialize variants -> exam_questions if no exam_questions exist yet
  IF v_existing_eq = 0 AND v_promotable_count >= v_min_per_lf THEN
    INSERT INTO exam_questions (
      curriculum_id, learning_field_id, competency_id,
      question_text, options, correct_answer, explanation,
      difficulty, status, ai_generated, blueprint_id,
      cognitive_level, question_type, is_trap,
      meta, certification_id
    )
    SELECT
      eqv.curriculum_id, eqv.learning_field_id, eqv.competency_id,
      eqv.question_text,
      COALESCE(eqv.options, '[]'::jsonb),
      COALESCE(
        CASE WHEN jsonb_typeof(eqv.correct_answer) = 'number'
             THEN (eqv.correct_answer)::text::int
             ELSE 0 END,
        0
      ),
      eqv.answer_text,
      'medium'::question_difficulty,
      'approved'::question_status,
      true,
      eqv.blueprint_id,
      eqv.cognitive_level,
      COALESCE(eqv.question_type, 'mc_single'),
      COALESCE(eqv.trap_type IS NOT NULL, false),
      jsonb_build_object(
        'source_variant_id', eqv.id,
        'promoted_at', v_now::text,
        'quality_score', eqv.quality_score,
        'promoted_by', 'fn_prebuild_promote_blueprint_variants_bridge'
      ),
      (SELECT cp2.certification_id FROM course_packages cp2 WHERE cp2.id = p_package_id)
    FROM exam_question_variants eqv
    WHERE eqv.curriculum_id = v_curriculum_id
      AND eqv.status IN ('review','approved','promoted')
      AND COALESCE(eqv.quality_score, 0) >= v_quality_threshold
      AND eqv.question_text IS NOT NULL
      AND length(eqv.question_text) > 20
      AND NOT EXISTS (
        SELECT 1 FROM exam_questions eq2
        WHERE eq2.meta->>'source_variant_id' = eqv.id::text
      );
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- Mark source variants as promoted
    UPDATE exam_question_variants eqv
    SET status = 'promoted', updated_at = v_now
    WHERE eqv.curriculum_id = v_curriculum_id
      AND eqv.status IN ('review','approved')
      AND COALESCE(eqv.quality_score, 0) >= v_quality_threshold
      AND EXISTS (SELECT 1 FROM exam_questions eq3 WHERE eq3.meta->>'source_variant_id' = eqv.id::text);
  END IF;

  -- Re-count
  SELECT count(*) INTO v_existing_eq FROM exam_questions eq WHERE eq.curriculum_id = v_curriculum_id;

  IF v_existing_eq = 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_PROMOTABLE_VARIANTS'::text,
      jsonb_build_object('promotable', v_promotable_count, 'inserted', v_inserted, 'threshold', v_quality_threshold);
    RETURN;
  END IF;

  -- Mark step done
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
      'promotable_source', v_promotable_count,
      'checked_at', v_now::text
    )
  WHERE ps.package_id = p_package_id AND ps.step_key = 'promote_blueprint_variants' AND ps.status != 'done';

  RETURN QUERY SELECT 'done'::text, true,
    CASE WHEN v_inserted > 0 THEN 'BRIDGE_MATERIALIZED' ELSE 'ARTIFACT_TRUTH_ADOPTED' END,
    jsonb_build_object('inserted', v_inserted, 'exam_questions', v_existing_eq);
END;
$function$;

-- ============================================================
-- WAVE 12b: Drift-Audit v2 — alle Materialization-RPCs prüfen
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_audit_materialization_drift()
RETURNS TABLE(
  fn_name text,
  drift_type text,
  detail text,
  severity text,
  suggestion text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec record;
  v_def text;
BEGIN
  FOR rec IN
    SELECT p.proname, p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'fn_prebuild_%' OR p.proname LIKE 'fn_materialize_%')
    ORDER BY p.proname
  LOOP
    v_def := pg_get_functiondef(rec.oid);

    -- 1. Ambiguous meta-column
    IF v_def ~* 'UPDATE\s+package_steps[^;]*SET[^;]*[^.\w]meta\s*=\s*COALESCE\(meta' THEN
      RETURN QUERY SELECT rec.proname::text, 'AMBIGUOUS_COLUMN'::text,
        'meta-column not qualified with table alias'::text, 'critical'::text,
        'Use ps.meta or alias.meta'::text;
    END IF;

    -- 2. Wrong column completed_at (real: finished_at)
    IF v_def ~* 'package_steps[^;]*completed_at' THEN
      RETURN QUERY SELECT rec.proname::text, 'WRONG_COLUMN'::text,
        'completed_at does not exist'::text, 'critical'::text,
        'Use finished_at'::text;
    END IF;

    -- 3. Missing guard flags
    IF v_def ~* 'UPDATE\s+package_steps[^;]*SET\s+status\s*=\s*''done'''
       AND v_def !~* '''ok''\s*,\s*true' THEN
      RETURN QUERY SELECT rec.proname::text, 'MISSING_GUARD_FLAG'::text,
        'meta missing ok=true (ghost-completion guard will block)'::text, 'high'::text,
        'Add jsonb_build_object(''ok'', true, ''executed'', true)'::text;
    END IF;

    -- 4. Wrong table singular/plural
    IF v_def ~* 'FROM\s+curriculums[^_]' OR v_def ~* 'JOIN\s+curriculums[^_]' THEN
      RETURN QUERY SELECT rec.proname::text, 'WRONG_TABLE'::text,
        'curriculums (plural) does not exist'::text, 'critical'::text,
        'Use curricula'::text;
    END IF;

    -- 5. Invalid status filter (rejected for variants)
    IF v_def ~* 'exam_question_variants[^;]*status[^;]*''rejected''' THEN
      RETURN QUERY SELECT rec.proname::text, 'INVALID_ENUM_FILTER'::text,
        'exam_question_variants has no status=rejected'::text, 'medium'::text,
        'Use review/approved/promoted only'::text;
    END IF;

    -- 6. Missing Bridge-Logic (only-check, no insert/update of artifacts)
    IF rec.proname IN ('fn_prebuild_promote_blueprint_variants', 'fn_prebuild_auto_seed_exam_blueprints')
       AND v_def !~* 'INSERT\s+INTO' THEN
      RETURN QUERY SELECT rec.proname::text, 'MISSING_BRIDGE'::text,
        'Function only checks but never inserts target artifacts'::text, 'high'::text,
        'Add INSERT bridge for missing artifacts'::text;
    END IF;
  END LOOP;
END;
$function$;

-- ============================================================
-- WAVE 12c: Sweep-RPC für Mass-Materialization
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_run_materialization_sweep_all(p_limit int DEFAULT 100)
RETURNS TABLE(
  package_id uuid,
  curriculum_title text,
  step_key text,
  step_status text,
  advanced boolean,
  reason text,
  meta jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec record;
  res record;
BEGIN
  FOR rec IN
    SELECT cp.id AS package_id, c.title AS curriculum_title
    FROM course_packages cp
    JOIN curricula c ON c.id = cp.curriculum_id
    WHERE cp.status NOT IN ('archived', 'draft_only')
      AND EXISTS (
        SELECT 1 FROM package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.step_key = 'promote_blueprint_variants'
          AND ps.status != 'done'
      )
    LIMIT p_limit
  LOOP
    BEGIN
      FOR res IN
        SELECT * FROM fn_prebuild_promote_blueprint_variants(rec.package_id)
      LOOP
        package_id := rec.package_id;
        curriculum_title := rec.curriculum_title;
        step_key := 'promote_blueprint_variants';
        step_status := res.step_status;
        advanced := res.advanced;
        reason := res.reason;
        meta := res.meta;
        RETURN NEXT;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      package_id := rec.package_id;
      curriculum_title := rec.curriculum_title;
      step_key := 'promote_blueprint_variants';
      step_status := 'error';
      advanced := false;
      reason := SQLERRM;
      meta := '{}'::jsonb;
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$;