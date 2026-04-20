
-- ════════════════════════════════════════════════════════════════════
-- Wave 13c: Per-row Hash-Kollisions-Toleranz in Promote-Bridge
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_prebuild_promote_blueprint_variants(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid; v_step_status text; v_now timestamptz := now();
  v_existing_eq int; v_total_variants int; v_inserted int := 0; v_skipped_collision int := 0;
  v_top_per_lf int := 10;
  v_variant RECORD;
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
    -- Per-row insert with collision tolerance
    FOR v_variant IN
      SELECT DISTINCT ON (eqv.blueprint_id, md5(eqv.question_text)) eqv.*,
        ROW_NUMBER() OVER (PARTITION BY eqv.learning_field_id
          ORDER BY COALESCE(eqv.quality_score, 0) DESC NULLS LAST, eqv.created_at ASC) AS rk
      FROM exam_question_variants eqv
      WHERE eqv.curriculum_id = v_curriculum_id
        AND eqv.status IN ('review','approved')
        AND eqv.question_text IS NOT NULL AND length(eqv.question_text) > 20
        AND eqv.learning_field_id IS NOT NULL AND eqv.blueprint_id IS NOT NULL
      ORDER BY eqv.blueprint_id, md5(eqv.question_text), COALESCE(eqv.quality_score, 0) DESC NULLS LAST, eqv.created_at ASC
    LOOP
      IF v_variant.rk > v_top_per_lf THEN CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM exam_questions eq2 WHERE eq2.meta->>'source_variant_id' = v_variant.id::text) THEN CONTINUE; END IF;

      BEGIN
        INSERT INTO exam_questions (
          curriculum_id, learning_field_id, competency_id, question_text, options, correct_answer, explanation,
          difficulty, status, ai_generated, blueprint_id, normalized_hash,
          cognitive_level, question_type, is_trap, meta, certification_id)
        VALUES (
          v_variant.curriculum_id, v_variant.learning_field_id, v_variant.competency_id, v_variant.question_text,
          COALESCE(v_variant.options, '[]'::jsonb),
          CASE
            WHEN v_variant.correct_answer IS NULL THEN 0
            WHEN jsonb_typeof(v_variant.correct_answer) = 'number' THEN
              GREATEST(0, FLOOR((v_variant.correct_answer)::text::numeric)::int)
            WHEN jsonb_typeof(v_variant.correct_answer) = 'string'
                 AND (v_variant.correct_answer #>> '{}') ~ '^[0-9]+$' THEN
              ((v_variant.correct_answer #>> '{}')::int)
            ELSE 0
          END,
          v_variant.answer_text, 'medium'::question_difficulty, 'approved'::question_status, true,
          v_variant.blueprint_id, md5(v_variant.question_text), v_variant.cognitive_level,
          CASE
            WHEN v_variant.question_type IN ('concept','procedure','calculation','case_study','transfer') THEN v_variant.question_type
            WHEN v_variant.question_type IN ('mc_single','mc_multi','true_false','short_answer') THEN 'concept'
            WHEN v_variant.question_type IN ('regulation','scenario') THEN 'case_study'
            WHEN v_variant.question_type IN ('oral_question','oral_prompt') THEN 'transfer'
            ELSE 'concept' END,
          COALESCE(v_variant.trap_type IS NOT NULL, false),
          jsonb_build_object('source_variant_id', v_variant.id, 'promoted_at', v_now::text,
            'quality_score', v_variant.quality_score, 'original_question_type', v_variant.question_type,
            'promoted_by', 'fn_prebuild_promote_blueprint_variants_topn_v3', 'rank_in_lf', v_variant.rk),
          (SELECT cp2.certification_id FROM course_packages cp2 WHERE cp2.id = p_package_id)
        );
        v_inserted := v_inserted + 1;
      EXCEPTION
        WHEN check_violation THEN  -- 23514 = GLOBAL_CANONICAL_COLLISION
          v_skipped_collision := v_skipped_collision + 1;
        WHEN unique_violation THEN  -- 23505 = (blueprint_id, normalized_hash) duplicate
          v_skipped_collision := v_skipped_collision + 1;
      END;
    END LOOP;

    UPDATE exam_question_variants eqv SET status = 'approved', updated_at = v_now
    WHERE eqv.curriculum_id = v_curriculum_id AND eqv.status = 'review'
      AND EXISTS (SELECT 1 FROM exam_questions eq3 WHERE eq3.meta->>'source_variant_id' = eqv.id::text);
  END IF;

  SELECT count(*) INTO v_existing_eq FROM exam_questions eq WHERE eq.curriculum_id = v_curriculum_id;

  IF v_existing_eq = 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_VARIANTS_AVAILABLE'::text,
      jsonb_build_object('total_variants', v_total_variants, 'inserted', v_inserted,
        'skipped_collision', v_skipped_collision); RETURN;
  END IF;

  UPDATE package_steps ps SET status = 'done',
    started_at = COALESCE(ps.started_at, v_now), finished_at = v_now,
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'ok', true, 'executed', true, 'prebuild', true, 'adopted', true,
      'adopted_from_ssot', true, 'inserted_questions', v_inserted,
      'skipped_collision', v_skipped_collision,
      'total_variants_seen', v_total_variants, 'adopted_at', v_now,
      'adopted_by', 'fn_prebuild_promote_blueprint_variants_v3')
  WHERE ps.package_id = p_package_id AND ps.step_key = 'promote_blueprint_variants' AND ps.status != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'ADOPTED_VIA_TOPN_BRIDGE_V3'::text,
    jsonb_build_object('inserted', v_inserted, 'existing_after', v_existing_eq,
      'total_variants', v_total_variants, 'skipped_collision', v_skipped_collision);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- Wave 15: Präzises Drift-Audit-System (4 Kategorien)
-- ════════════════════════════════════════════════════════════════════

-- 1. Syntax/Schema Drift
CREATE OR REPLACE FUNCTION public.fn_audit_drift_syntax_schema()
RETURNS TABLE(category text, function_name text, severity text, issue text, evidence text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE rec RECORD; v_def text;
BEGIN
  FOR rec IN SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname LIKE 'fn_prebuild_%' LOOP
    v_def := pg_get_functiondef(('public.'||rec.proname)::regproc);
    -- Unqualifizierte meta-Updates auf package_steps
    IF v_def ~* 'UPDATE\s+package_steps[^;]*SET[^;]*[^.\w]meta\s*=\s*COALESCE\(\s*meta\s*,' THEN
      RETURN QUERY SELECT 'syntax_schema'::text, rec.proname, 'critical'::text,
        'unqualified_meta_in_update'::text, 'COALESCE(meta,) without ps. prefix'::text;
    END IF;
    -- Falsche Tabellennamen
    IF v_def ~* '\mFROM\s+curriculums\M' OR v_def ~* '\mJOIN\s+curriculums\M' THEN
      RETURN QUERY SELECT 'syntax_schema'::text, rec.proname, 'critical'::text,
        'wrong_table_curriculums'::text, 'should be curricula (singular plural)'::text;
    END IF;
    -- Falsche Spaltenname
    IF v_def ~* '\mcompleted_at\s*=' THEN
      RETURN QUERY SELECT 'syntax_schema'::text, rec.proname, 'critical'::text,
        'wrong_column_completed_at'::text, 'should be finished_at'::text;
    END IF;
  END LOOP;
END; $$;

-- 2. Step-Finalization Drift
CREATE OR REPLACE FUNCTION public.fn_audit_drift_step_finalization()
RETURNS TABLE(category text, function_name text, severity text, issue text, evidence text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE rec RECORD; v_def text;
BEGIN
  FOR rec IN SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname LIKE 'fn_prebuild_%' LOOP
    v_def := pg_get_functiondef(('public.'||rec.proname)::regproc);
    -- Muss sowohl ok=true als auch executed=true setzen, sonst Ghost-Completion-Guard blockt
    IF v_def ~* 'UPDATE\s+package_steps' AND v_def ~* 'status\s*=\s*''done''' THEN
      IF v_def !~* '''ok''[^,]*,\s*true' THEN
        RETURN QUERY SELECT 'step_finalization'::text, rec.proname, 'high'::text,
          'missing_ok_flag'::text, 'sets status=done but no ok=true in meta'::text;
      END IF;
      IF v_def !~* '''executed''[^,]*,\s*true' THEN
        RETURN QUERY SELECT 'step_finalization'::text, rec.proname, 'high'::text,
          'missing_executed_flag'::text, 'sets status=done but no executed=true in meta'::text;
      END IF;
    END IF;
  END LOOP;
END; $$;

-- 3. Bridge-Presence Drift (Materialisierung muss vorhanden sein)
CREATE OR REPLACE FUNCTION public.fn_audit_drift_bridge_presence()
RETURNS TABLE(category text, function_name text, severity text, issue text, evidence text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE rec RECORD; v_def text;
  v_bridge_specs jsonb := jsonb_build_object(
    'fn_prebuild_auto_seed_exam_blueprints', 'INSERT INTO exam_blueprints',
    'fn_prebuild_promote_blueprint_variants', 'INSERT INTO exam_questions',
    'fn_prebuild_generate_blueprint_variants', 'INSERT INTO exam_question_variants'
  );
  v_key text;
BEGIN
  FOR v_key IN SELECT jsonb_object_keys(v_bridge_specs) LOOP
    BEGIN
      v_def := pg_get_functiondef(('public.'||v_key)::regproc);
      IF position((v_bridge_specs->>v_key) IN v_def) = 0 THEN
        RETURN QUERY SELECT 'bridge_presence'::text, v_key, 'critical'::text,
          'missing_materialization'::text, format('expected: %s', v_bridge_specs->>v_key);
      END IF;
    EXCEPTION WHEN undefined_function THEN
      RETURN QUERY SELECT 'bridge_presence'::text, v_key, 'critical'::text,
        'function_missing'::text, 'expected pre-build RPC does not exist'::text;
    END;
  END LOOP;
END; $$;

-- 4. Enum/Domain Drift
CREATE OR REPLACE FUNCTION public.fn_audit_drift_enum_domain()
RETURNS TABLE(category text, function_name text, severity text, issue text, evidence text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE rec RECORD; v_def text;
BEGIN
  FOR rec IN SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname LIKE 'fn_prebuild_%' LOOP
    v_def := pg_get_functiondef(('public.'||rec.proname)::regproc);
    -- exam_question_variants Status: nur draft/review/approved/archived erlaubt; 'rejected'/'promoted' sind invalid
    IF v_def ~* 'status\s*=\s*''rejected''' THEN
      RETURN QUERY SELECT 'enum_domain'::text, rec.proname, 'critical'::text,
        'invalid_variant_status_rejected'::text, 'use archived instead'::text;
    END IF;
    IF v_def ~* 'status\s*=\s*''promoted''' THEN
      RETURN QUERY SELECT 'enum_domain'::text, rec.proname, 'critical'::text,
        'invalid_variant_status_promoted'::text, 'use approved instead'::text;
    END IF;
    -- question_type enum domain check (nur die 5 erlaubten Typen)
    IF v_def ~* 'question_type\s+IN\s*\(' AND v_def !~* 'concept|case_study' THEN
      RETURN QUERY SELECT 'enum_domain'::text, rec.proname, 'high'::text,
        'question_type_filter_no_domain_mapping'::text, 'check question_type IN(...) covers domain'::text;
    END IF;
  END LOOP;
END; $$;

-- Master Aggregator
CREATE OR REPLACE FUNCTION public.fn_audit_all_drift()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_findings jsonb := '[]'::jsonb; v_row RECORD;
BEGIN
  FOR v_row IN SELECT * FROM fn_audit_drift_syntax_schema() LOOP
    v_findings := v_findings || to_jsonb(v_row); END LOOP;
  FOR v_row IN SELECT * FROM fn_audit_drift_step_finalization() LOOP
    v_findings := v_findings || to_jsonb(v_row); END LOOP;
  FOR v_row IN SELECT * FROM fn_audit_drift_bridge_presence() LOOP
    v_findings := v_findings || to_jsonb(v_row); END LOOP;
  FOR v_row IN SELECT * FROM fn_audit_drift_enum_domain() LOOP
    v_findings := v_findings || to_jsonb(v_row); END LOOP;
  RETURN jsonb_build_object('ok', jsonb_array_length(v_findings)=0,
    'finding_count', jsonb_array_length(v_findings),
    'critical_count', (SELECT COUNT(*) FROM jsonb_array_elements(v_findings) e WHERE e->>'severity'='critical'),
    'findings', v_findings, 'audited_at', now());
END; $$;
