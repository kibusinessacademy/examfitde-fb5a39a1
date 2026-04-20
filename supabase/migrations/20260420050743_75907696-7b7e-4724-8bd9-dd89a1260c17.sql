-- =========================================================================
-- WAVE 13c: Row-Tolerant Promote-Bridge (per-row collision handling)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.fn_prebuild_promote_blueprint_variants(p_package_id uuid)
RETURNS TABLE(
  step_status text,
  advanced boolean,
  reason text,
  meta jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_now timestamptz := now();
  v_curriculum_id uuid;
  v_existing_eq int := 0;
  v_total_variants int := 0;
  v_inserted int := 0;
  v_collisions int := 0;
  v_skipped_existing int := 0;
  v_top_per_lf int := 6;
  v_variant RECORD;
  v_reason text;
  v_certification_id uuid;
BEGIN
  SELECT cp.curriculum_id, cp.certification_id
  INTO v_curriculum_id, v_certification_id
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN QUERY
    SELECT
      'blocked'::text,
      false,
      'NO_CURRICULUM'::text,
      jsonb_build_object('package_id', p_package_id);
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_existing_eq
  FROM exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id;

  SELECT count(*)
  INTO v_total_variants
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
          ORDER BY
            eqv.blueprint_id,
            md5(eqv.question_text),
            COALESCE(eqv.quality_score, 0) DESC NULLS LAST,
            eqv.created_at ASC
        ) s
        WHERE s.rk <= v_top_per_lf
      )
      SELECT * FROM ranked
    LOOP
      IF EXISTS (
        SELECT 1
        FROM exam_questions eq2
        WHERE eq2.meta->>'source_variant_id' = v_variant.id::text
      ) THEN
        v_skipped_existing := v_skipped_existing + 1;
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO exam_questions (
          curriculum_id,
          learning_field_id,
          competency_id,
          question_text,
          options,
          correct_answer,
          explanation,
          difficulty,
          status,
          ai_generated,
          blueprint_id,
          normalized_hash,
          cognitive_level,
          question_type,
          is_trap,
          meta,
          certification_id
        )
        VALUES (
          v_variant.curriculum_id,
          v_variant.learning_field_id,
          v_variant.competency_id,
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
          COALESCE(v_variant.trap_type IS NOT NULL, false),
          jsonb_build_object(
            'source_variant_id', v_variant.id,
            'promoted_at', v_now,
            'quality_score', v_variant.quality_score,
            'original_question_type', v_variant.question_type,
            'promoted_by', 'fn_prebuild_promote_blueprint_variants_row_tolerant',
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
          v_collisions := v_collisions + 1;
          CONTINUE;
        WHEN OTHERS THEN
          IF SQLERRM ILIKE '%GLOBAL_CANONICAL_COLLISION%'
             OR SQLERRM ILIKE '%canonical%collision%'
             OR SQLERRM ILIKE '%duplicate%' THEN
            v_collisions := v_collisions + 1;
            CONTINUE;
          ELSE
            RAISE;
          END IF;
      END;
    END LOOP;

    UPDATE exam_question_variants eqv
    SET status = 'approved',
        updated_at = v_now
    WHERE eqv.curriculum_id = v_curriculum_id
      AND eqv.status = 'review'
      AND EXISTS (
        SELECT 1
        FROM exam_questions eq3
        WHERE eq3.meta->>'source_variant_id' = eqv.id::text
      );
  END IF;

  SELECT count(*)
  INTO v_existing_eq
  FROM exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id;

  IF v_existing_eq = 0 THEN
    RETURN QUERY
    SELECT
      'deferred'::text,
      false,
      'NO_VARIANTS_MATERIALIZED'::text,
      jsonb_build_object(
        'total_variants', v_total_variants,
        'inserted', v_inserted,
        'collisions', v_collisions,
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
        'ok', true,
        'executed', true,
        'prebuild', true,
        'adopted', true,
        'adopted_from_ssot', true,
        'prebuild_fn', 'fn_prebuild_promote_blueprint_variants',
        'strategy', 'top_n_per_lf_row_tolerant',
        'top_n', v_top_per_lf,
        'inserted_questions', v_inserted,
        'collisions_skipped', v_collisions,
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

  RETURN QUERY
  SELECT
    'done'::text,
    true,
    v_reason,
    jsonb_build_object(
      'inserted', v_inserted,
      'collisions_skipped', v_collisions,
      'skipped_existing', v_skipped_existing,
      'exam_questions_total', v_existing_eq
    );
END;
$function$;

-- =========================================================================
-- WAVE 13c: Präzises Drift-Audit (4 fokussierte Regeln statt Regex-Sweep)
-- =========================================================================

-- 1) Step-Finalisierung: fn_prebuild_* mit status='done' MUSS ok+executed setzen
CREATE OR REPLACE FUNCTION public.fn_audit_drift_step_finalization_v2()
RETURNS TABLE(
  function_name text,
  rule text,
  severity text,
  detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  rec RECORD;
  v_def text;
BEGIN
  FOR rec IN
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'fn_prebuild_%'
  LOOP
    v_def := pg_get_functiondef(rec.proname::regproc);

    IF v_def ~* 'status\s*=\s*''done''' THEN
      IF v_def !~* '''ok''\s*,\s*true' THEN
        RETURN QUERY SELECT rec.proname, 'STEP_DONE_MISSING_OK'::text,
          'critical'::text, 'sets status=done aber kein ok:true im meta'::text;
      END IF;
      IF v_def !~* '''executed''\s*,\s*true' THEN
        RETURN QUERY SELECT rec.proname, 'STEP_DONE_MISSING_EXECUTED'::text,
          'critical'::text, 'sets status=done aber kein executed:true im meta'::text;
      END IF;
      IF v_def !~* 'finished_at' THEN
        RETURN QUERY SELECT rec.proname, 'STEP_DONE_MISSING_FINISHED_AT'::text,
          'high'::text, 'sets status=done aber finished_at nicht gesetzt'::text;
      END IF;
    END IF;
  END LOOP;
END;
$function$;

-- 2) Bridge-Presence: bekannte Materialisierer MÜSSEN INSERT haben
CREATE OR REPLACE FUNCTION public.fn_audit_drift_bridge_presence_v2()
RETURNS TABLE(
  function_name text,
  rule text,
  severity text,
  detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  rec RECORD;
  v_def text;
  v_required text[] := ARRAY[
    'fn_prebuild_promote_blueprint_variants',
    'fn_prebuild_generate_blueprint_variants',
    'fn_prebuild_auto_seed_exam_blueprints'
  ];
  v_target_table text;
BEGIN
  FOREACH rec.proname IN ARRAY v_required LOOP
    BEGIN
      v_def := pg_get_functiondef(rec.proname::regproc);
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT rec.proname, 'BRIDGE_FUNCTION_MISSING'::text,
        'critical'::text, 'Funktion existiert nicht'::text;
      CONTINUE;
    END;

    v_target_table := CASE rec.proname
      WHEN 'fn_prebuild_promote_blueprint_variants' THEN 'exam_questions'
      WHEN 'fn_prebuild_generate_blueprint_variants' THEN 'exam_question_variants'
      WHEN 'fn_prebuild_auto_seed_exam_blueprints' THEN 'exam_blueprints'
    END;

    IF v_def !~* ('INSERT\s+INTO\s+' || v_target_table) THEN
      RETURN QUERY SELECT rec.proname, 'BRIDGE_NO_MATERIALIZATION'::text,
        'critical'::text,
        ('Bridge-RPC ohne INSERT INTO ' || v_target_table)::text;
    END IF;
  END LOOP;
END;
$function$;

-- 3) Schema-Domain: problematische Literale
CREATE OR REPLACE FUNCTION public.fn_audit_drift_schema_domain_v2()
RETURNS TABLE(
  function_name text,
  rule text,
  severity text,
  detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  rec RECORD;
  v_def text;
BEGIN
  FOR rec IN
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'fn_prebuild_%'
  LOOP
    v_def := pg_get_functiondef(rec.proname::regproc);

    IF v_def ~* '\mcompleted_at\M' THEN
      RETURN QUERY SELECT rec.proname, 'WRONG_COLUMN_COMPLETED_AT'::text,
        'critical'::text, 'verwendet completed_at, korrekte Spalte ist finished_at'::text;
    END IF;
    IF v_def ~* '\mFROM\s+curriculums\M' OR v_def ~* '\mJOIN\s+curriculums\M' THEN
      RETURN QUERY SELECT rec.proname, 'WRONG_TABLE_CURRICULUMS'::text,
        'critical'::text, 'verwendet Tabelle "curriculums", korrekt ist "curricula"'::text;
    END IF;
    IF v_def ~* 'status\s+IN\s*\([^)]*''rejected''[^)]*\)' AND v_def ~* 'exam_question_variants' THEN
      RETURN QUERY SELECT rec.proname, 'INVALID_VARIANT_STATUS_REJECTED'::text,
        'high'::text, 'filtert Varianten-Status "rejected" — existiert in Domain nicht'::text;
    END IF;
    IF v_def ~* 'status\s*=\s*''promoted''' AND v_def ~* 'exam_question_variants' THEN
      RETURN QUERY SELECT rec.proname, 'INVALID_VARIANT_STATUS_PROMOTED'::text,
        'high'::text, 'setzt Varianten-Status "promoted" — existiert in Domain nicht'::text;
    END IF;
  END LOOP;
END;
$function$;

-- 4) Bare-meta Risk: nur flaggen wenn UPDATE package_steps ohne Alias-Qualifikation
CREATE OR REPLACE FUNCTION public.fn_audit_drift_bare_meta_v2()
RETURNS TABLE(
  function_name text,
  rule text,
  severity text,
  detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  rec RECORD;
  v_def text;
BEGIN
  FOR rec IN
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'fn_prebuild_%'
  LOOP
    v_def := pg_get_functiondef(rec.proname::regproc);

    -- Nur kritisch wenn: (a) RETURNS TABLE mit meta jsonb, (b) UPDATE package_steps,
    -- (c) SET meta = COALESCE(meta, ...) ohne Alias-Präfix
    IF v_def ~* 'RETURNS\s+TABLE\s*\([^)]*meta\s+jsonb'
       AND v_def ~* 'UPDATE\s+package_steps'
       AND v_def ~* 'SET[^;]*[^.\w]meta\s*=\s*COALESCE\(\s*meta\b'
    THEN
      RETURN QUERY SELECT rec.proname, 'AMBIGUOUS_META_REFERENCE'::text,
        'critical'::text,
        'UPDATE package_steps SET meta = COALESCE(meta,...) ohne Alias — Kollision mit RETURN-meta'::text;
    END IF;
  END LOOP;
END;
$function$;

-- Aggregator für UI/Cron
CREATE OR REPLACE FUNCTION public.fn_audit_all_drift_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_findings jsonb;
  v_critical int;
  v_high int;
  v_total int;
BEGIN
  WITH all_findings AS (
    SELECT 'step_finalization' AS category, * FROM fn_audit_drift_step_finalization_v2()
    UNION ALL
    SELECT 'bridge_presence' AS category, * FROM fn_audit_drift_bridge_presence_v2()
    UNION ALL
    SELECT 'schema_domain' AS category, * FROM fn_audit_drift_schema_domain_v2()
    UNION ALL
    SELECT 'bare_meta' AS category, * FROM fn_audit_drift_bare_meta_v2()
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'category', category,
      'function', function_name,
      'rule', rule,
      'severity', severity,
      'detail', detail
    ) ORDER BY severity, category, function_name),
    count(*) FILTER (WHERE severity = 'critical'),
    count(*) FILTER (WHERE severity = 'high'),
    count(*)
  INTO v_findings, v_critical, v_high, v_total
  FROM all_findings;

  RETURN jsonb_build_object(
    'audit_at', now(),
    'total_findings', COALESCE(v_total, 0),
    'critical_count', COALESCE(v_critical, 0),
    'high_count', COALESCE(v_high, 0),
    'findings', COALESCE(v_findings, '[]'::jsonb)
  );
END;
$function$;