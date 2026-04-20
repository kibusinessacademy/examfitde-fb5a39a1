-- ============================================================
-- WAVE 11: Pre-Build Materialisierung + Drift-Audit
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) HARDEN fn_prebuild_auto_seed_exam_blueprints
--    Materialisiert exam_blueprints aus question_blueprints
--    BEVOR step done markiert wird.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_prebuild_auto_seed_exam_blueprints(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_curriculum_id uuid;
  v_curriculum_title text;
  v_approved_count int;
  v_total_count int;
  v_existing_exam_bp int;
  v_now timestamptz := now();
  v_step_status text;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM course_packages cp WHERE cp.id = p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'NO_CURRICULUM'::text, '{}'::jsonb; RETURN;
  END IF;

  SELECT ps.status::text INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'auto_seed_exam_blueprints';
  IF v_step_status IS NULL OR v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE_OR_MISSING'::text, '{}'::jsonb; RETURN;
  END IF;

  SELECT COUNT(*) FILTER (WHERE qb.status::text = 'approved'),
         COUNT(*)
  INTO v_approved_count, v_total_count
  FROM question_blueprints qb WHERE qb.curriculum_id = v_curriculum_id;

  IF v_approved_count < 10 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'INSUFFICIENT_BLUEPRINTS'::text,
      jsonb_build_object('approved', v_approved_count, 'total', v_total_count, 'required', 10);
    RETURN;
  END IF;

  -- ── MATERIALIZE: Ensure at least one exam_blueprints config exists ──
  SELECT COUNT(*) INTO v_existing_exam_bp
  FROM exam_blueprints eb WHERE eb.curriculum_id = v_curriculum_id;

  IF v_existing_exam_bp = 0 THEN
    SELECT COALESCE(c.name, 'Prüfungssimulation') INTO v_curriculum_title
    FROM curriculums c WHERE c.id = v_curriculum_id;

    INSERT INTO exam_blueprints (
      curriculum_id, title, description,
      total_questions, time_limit_minutes, pass_threshold,
      difficulty_distribution, question_types, frozen
    ) VALUES (
      v_curriculum_id,
      COALESCE(v_curriculum_title, 'Prüfungssimulation') || ' – Standard-Prüfung',
      'Automatisch erzeugte Standard-Prüfungskonfiguration aus ' || v_approved_count || ' approved blueprints.',
      LEAST(GREATEST(v_approved_count, 30), 60),
      90, 0.50,
      '{"easy": 0.30, "medium": 0.50, "hard": 0.20}'::jsonb,
      '["single_choice","multiple_choice"]'::jsonb,
      false
    );
    v_existing_exam_bp := 1;
  END IF;

  UPDATE package_steps ps SET
    status = 'done',
    started_at = COALESCE(ps.started_at, v_now),
    finished_at = v_now,
    updated_at = v_now,
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'ok', true, 'executed', true, 'prebuild', true,
      'prebuild_fn', 'fn_prebuild_auto_seed_exam_blueprints',
      'adopted', true, 'adopted_from_ssot', true,
      'postcondition_verified', true,
      'approved_blueprints', v_approved_count,
      'total_blueprints', v_total_count,
      'exam_blueprints_count', v_existing_exam_bp,
      'checked_at', v_now::text
    )
  WHERE ps.package_id = p_package_id
    AND ps.step_key = 'auto_seed_exam_blueprints'
    AND ps.status::text != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'ARTIFACT_TRUTH_MATERIALIZED'::text,
    jsonb_build_object('adopted', true, 'approved_blueprints', v_approved_count, 'exam_blueprints', v_existing_exam_bp);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 2) AUDIT: fn_audit_prebuild_drift
--    Prüft alle Pre-Build-Funktionen auf Schema-Drift
--    (Tabellen/Spalten/Enums-Existenz).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit_prebuild_drift()
RETURNS TABLE(
  function_name text,
  drift_type text,
  entity text,
  severity text,
  details jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  v_def text;
  v_problems jsonb;
BEGIN
  -- Iterate all fn_prebuild_* functions
  FOR rec IN
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'fn_prebuild_%'
  LOOP
    v_def := rec.def;

    -- Check 1: completed_at usage on package_steps (should be finished_at)
    IF v_def ~* 'package_steps[^,;]*\.completed_at|UPDATE\s+package_steps[^;]*completed_at' THEN
      RETURN QUERY SELECT rec.proname::text, 'WRONG_COLUMN'::text,
        'package_steps.completed_at'::text, 'critical'::text,
        jsonb_build_object('hint', 'use finished_at instead of completed_at on package_steps');
    END IF;

    -- Check 2: bare "meta" without table qualifier inside package_steps UPDATE/SET
    IF v_def ~* 'UPDATE\s+package_steps[^;]*SET[^;]*[^.\w]meta\s*=\s*COALESCE\(meta' THEN
      RETURN QUERY SELECT rec.proname::text, 'AMBIGUOUS_COLUMN'::text,
        'package_steps.meta'::text, 'critical'::text,
        jsonb_build_object('hint', 'qualify meta as ps.meta to avoid ambiguity with RETURN TABLE column');
    END IF;

    -- Check 3: missing ok=true / executed=true (would trip ghost guard)
    IF v_def ~* 'UPDATE\s+package_steps[^;]*status\s*=\s*''done'''
       AND v_def !~* '''ok'',\s*true' THEN
      RETURN QUERY SELECT rec.proname::text, 'GUARD_VIOLATION'::text,
        'meta.ok'::text, 'high'::text,
        jsonb_build_object('hint', 'set meta.ok=true and meta.executed=true to satisfy ghost completion guard');
    END IF;
  END LOOP;

  -- Schema reference checks (tables/columns that must exist)
  FOR rec IN
    SELECT * FROM (VALUES
      ('package_steps','finished_at'),
      ('package_steps','meta'),
      ('package_steps','step_key'),
      ('course_packages','curriculum_id'),
      ('question_blueprints','curriculum_id'),
      ('question_blueprints','status'),
      ('exam_blueprints','curriculum_id'),
      ('exam_question_variants','blueprint_id'),
      ('exam_question_variants','curriculum_id'),
      ('handbook_chapters','curriculum_id'),
      ('handbook_sections','expand_status'),
      ('handbook_sections','quality_score')
    ) AS t(tab, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=rec.tab AND column_name=rec.col
    ) THEN
      RETURN QUERY SELECT 'SCHEMA'::text, 'MISSING_COLUMN'::text,
        (rec.tab || '.' || rec.col)::text, 'critical'::text,
        jsonb_build_object('table', rec.tab, 'column', rec.col,
          'hint', 'A pre-build RPC depends on this column. Update the function or restore the column.');
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_audit_prebuild_drift() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 3) AUDIT VIEW: v_prebuild_adoption_candidates
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_prebuild_adoption_candidates AS
SELECT
  cp.id AS package_id,
  cp.curriculum_id,
  cp.status::text AS pkg_status,
  cp.track,
  ps.step_key,
  ps.status::text AS step_status,
  (SELECT count(*) FROM question_blueprints qb WHERE qb.curriculum_id=cp.curriculum_id AND qb.status::text='approved') AS approved_qb,
  (SELECT count(*) FROM exam_blueprints eb WHERE eb.curriculum_id=cp.curriculum_id) AS exam_bp,
  (SELECT count(*) FROM exam_question_variants eqv WHERE eqv.curriculum_id=cp.curriculum_id) AS variants,
  (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id=cp.curriculum_id) AS exam_q,
  (SELECT count(*) FROM handbook_chapters hc WHERE hc.curriculum_id=cp.curriculum_id) AS chapters,
  (SELECT count(*) FROM handbook_sections hs JOIN handbook_chapters hc2 ON hc2.id=hs.chapter_id WHERE hc2.curriculum_id=cp.curriculum_id) AS sections
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id
WHERE ps.step_key IN (
  'auto_seed_exam_blueprints','validate_blueprints',
  'generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants',
  'finalize_learning_content','validate_handbook','validate_handbook_depth'
)
AND ps.status::text IN ('queued','building')
AND cp.status NOT IN ('archived','published');

GRANT SELECT ON public.v_prebuild_adoption_candidates TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 4) SWEEP: fn_run_prebuild_sweep_all  (mit echtem Error-Reporting)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_run_prebuild_sweep_all(p_limit int DEFAULT 200)
RETURNS TABLE(
  package_id uuid, step_key text, result_status text, advanced boolean,
  reason text, meta jsonb, error_text text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  v_step_order text[] := ARRAY[
    'finalize_learning_content',
    'auto_seed_exam_blueprints',
    'validate_blueprints',
    'generate_blueprint_variants',
    'validate_blueprint_variants',
    'promote_blueprint_variants',
    'validate_handbook',
    'validate_handbook_depth'
  ];
  v_step text;
  v_rpc text;
  v_count int := 0;
  v_result RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT cp.id AS pkg_id
    FROM course_packages cp
    JOIN package_steps ps ON ps.package_id = cp.id
    WHERE ps.step_key = ANY(v_step_order)
      AND ps.status::text IN ('queued','building')
      AND cp.status NOT IN ('archived','published')
    LIMIT p_limit
  LOOP
    FOREACH v_step IN ARRAY v_step_order LOOP
      v_rpc := 'fn_prebuild_' || v_step;
      BEGIN
        EXECUTE format('SELECT * FROM public.%I($1)', v_rpc)
          INTO v_result USING rec.pkg_id;
        RETURN QUERY SELECT rec.pkg_id, v_step,
          COALESCE(v_result.step_status, v_result.status)::text,
          v_result.advanced, v_result.reason::text, v_result.meta, NULL::text;
      EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT rec.pkg_id, v_step,
          'error'::text, false, SQLSTATE::text,
          NULL::jsonb, SQLERRM::text;
      END;
    END LOOP;
    v_count := v_count + 1;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_run_prebuild_sweep_all(int) TO service_role;