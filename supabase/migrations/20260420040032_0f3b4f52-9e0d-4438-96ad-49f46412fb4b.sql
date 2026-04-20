-- 1) FIX: fn_prebuild_auto_seed_exam_blueprints (curriculums → curricula)
CREATE OR REPLACE FUNCTION public.fn_prebuild_auto_seed_exam_blueprints(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_curriculum_id uuid; v_curriculum_title text;
  v_approved_count int; v_total_count int; v_existing_exam_bp int;
  v_now timestamptz := now(); v_step_status text;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id=p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text,false,'NO_CURRICULUM'::text,'{}'::jsonb; RETURN;
  END IF;

  SELECT ps.status::text INTO v_step_status FROM package_steps ps
   WHERE ps.package_id=p_package_id AND ps.step_key='auto_seed_exam_blueprints';
  IF v_step_status IS NULL OR v_step_status='done' THEN
    RETURN QUERY SELECT 'noop'::text,false,'ALREADY_DONE_OR_MISSING'::text,'{}'::jsonb; RETURN;
  END IF;

  SELECT COUNT(*) FILTER (WHERE qb.status::text='approved'), COUNT(*)
   INTO v_approved_count, v_total_count
   FROM question_blueprints qb WHERE qb.curriculum_id=v_curriculum_id;
  IF v_approved_count < 10 THEN
    RETURN QUERY SELECT 'blocked'::text,false,'INSUFFICIENT_BLUEPRINTS'::text,
      jsonb_build_object('approved',v_approved_count,'total',v_total_count,'required',10); RETURN;
  END IF;

  SELECT COUNT(*) INTO v_existing_exam_bp
   FROM exam_blueprints eb WHERE eb.curriculum_id=v_curriculum_id;

  IF v_existing_exam_bp = 0 THEN
    -- ✅ FIX: curricula (not curriculums)
    SELECT COALESCE(c.name, c.title, 'Prüfungssimulation') INTO v_curriculum_title
     FROM curricula c WHERE c.id=v_curriculum_id;

    INSERT INTO exam_blueprints (
      curriculum_id, title, description,
      total_questions, time_limit_minutes, pass_threshold,
      difficulty_distribution, question_types, frozen
    ) VALUES (
      v_curriculum_id,
      COALESCE(v_curriculum_title,'Prüfungssimulation') || ' – Standard-Prüfung',
      'Auto-materialisiert aus ' || v_approved_count || ' approved blueprints.',
      LEAST(GREATEST(v_approved_count,30),60), 90, 0.50,
      '{"easy":0.30,"medium":0.50,"hard":0.20}'::jsonb,
      '["single_choice","multiple_choice"]'::jsonb,
      false
    );
    v_existing_exam_bp := 1;
  END IF;

  UPDATE package_steps ps SET
    status='done', started_at=COALESCE(ps.started_at,v_now),
    finished_at=v_now, updated_at=v_now,
    meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
      'ok',true,'executed',true,'prebuild',true,
      'prebuild_fn','fn_prebuild_auto_seed_exam_blueprints',
      'adopted',true,'adopted_from_ssot',true,'postcondition_verified',true,
      'approved_blueprints',v_approved_count,'total_blueprints',v_total_count,
      'exam_blueprints_count',v_existing_exam_bp,'checked_at',v_now::text)
  WHERE ps.package_id=p_package_id AND ps.step_key='auto_seed_exam_blueprints'
    AND ps.status::text!='done';

  RETURN QUERY SELECT 'done'::text,true,'ARTIFACT_TRUTH_MATERIALIZED'::text,
    jsonb_build_object('adopted',true,'approved_blueprints',v_approved_count,
                       'exam_blueprints',v_existing_exam_bp);
END;
$$;

-- 2) FIX: fn_prebuild_validate_blueprints (rejected raus, nur valide enum-werte)
CREATE OR REPLACE FUNCTION public.fn_prebuild_validate_blueprints(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_curriculum_id uuid; v_total int; v_terminal int; v_now timestamptz:=now(); v_step_status text;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id=p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text,false,'NO_CURRICULUM'::text,'{}'::jsonb; RETURN;
  END IF;
  SELECT ps.status::text INTO v_step_status FROM package_steps ps
   WHERE ps.package_id=p_package_id AND ps.step_key='validate_blueprints';
  IF v_step_status IS NULL OR v_step_status='done' THEN
    RETURN QUERY SELECT 'noop'::text,false,'ALREADY_DONE_OR_MISSING'::text,'{}'::jsonb; RETURN;
  END IF;
  -- ✅ FIX: nur tatsächliche Enum-Werte (approved/deprecated/review/draft)
  -- Terminal = 'approved' | 'deprecated' (nicht draft/review)
  SELECT COUNT(*), COUNT(*) FILTER (WHERE qb.status::text IN ('approved','deprecated','review'))
   INTO v_total, v_terminal
   FROM question_blueprints qb WHERE qb.curriculum_id=v_curriculum_id;
  IF v_total=0 THEN
    RETURN QUERY SELECT 'blocked'::text,false,'NO_BLUEPRINTS'::text,'{}'::jsonb; RETURN;
  END IF;
  IF v_terminal < v_total THEN
    RETURN QUERY SELECT 'deferred'::text,false,'NON_TERMINAL_BLUEPRINTS'::text,
      jsonb_build_object('total',v_total,'terminal',v_terminal); RETURN;
  END IF;
  UPDATE package_steps ps SET
    status='done', started_at=COALESCE(ps.started_at,v_now),
    finished_at=v_now, updated_at=v_now,
    meta=COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
      'ok',true,'executed',true,'prebuild',true,
      'prebuild_fn','fn_prebuild_validate_blueprints',
      'adopted',true,'adopted_from_ssot',true,'postcondition_verified',true,
      'total_blueprints',v_total,'terminal_blueprints',v_terminal,'checked_at',v_now::text)
  WHERE ps.package_id=p_package_id AND ps.step_key='validate_blueprints' AND ps.status::text!='done';
  RETURN QUERY SELECT 'done'::text,true,'ARTIFACT_TRUTH_ADOPTED'::text,
    jsonb_build_object('adopted',true,'total',v_total);
END;
$$;

-- 3) FIX: fn_run_prebuild_sweep_all (robust column mapping)
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
    'finalize_learning_content','auto_seed_exam_blueprints','validate_blueprints',
    'generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants',
    'validate_handbook','validate_handbook_depth'
  ];
  v_step text; v_rpc text;
  v_status text; v_advanced boolean; v_reason text; v_meta jsonb;
BEGIN
  FOR rec IN
    SELECT DISTINCT cp.id AS pkg_id
    FROM course_packages cp
    JOIN package_steps ps ON ps.package_id=cp.id
    WHERE ps.step_key=ANY(v_step_order)
      AND ps.status::text IN ('queued','building')
      AND cp.status NOT IN ('archived','published')
    LIMIT p_limit
  LOOP
    FOREACH v_step IN ARRAY v_step_order LOOP
      v_rpc := 'fn_prebuild_' || v_step;
      BEGIN
        -- Use json round-trip to handle either {status} or {step_status}
        EXECUTE format($q$
          SELECT COALESCE(j->>'step_status', j->>'status'),
                 (j->>'advanced')::boolean,
                 j->>'reason',
                 (j->'meta')::jsonb
          FROM (SELECT to_jsonb(r.*) AS j FROM public.%I($1) r LIMIT 1) sub
        $q$, v_rpc) INTO v_status, v_advanced, v_reason, v_meta USING rec.pkg_id;
        RETURN QUERY SELECT rec.pkg_id, v_step,
          v_status, COALESCE(v_advanced,false), v_reason, v_meta, NULL::text;
      EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT rec.pkg_id, v_step,
          'error'::text, false, SQLSTATE::text, NULL::jsonb, SQLERRM::text;
      END;
    END LOOP;
  END LOOP;
END;
$$;

-- 4) ENHANCE Drift Audit: Tabellen-Existenz + Enum-Werte prüfen
CREATE OR REPLACE FUNCTION public.fn_audit_prebuild_drift()
RETURNS TABLE(function_name text, drift_type text, entity text, severity text, details jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD; v_def text;
  v_known_tables text[] := ARRAY[
    'package_steps','course_packages','question_blueprints','exam_blueprints',
    'exam_question_variants','exam_questions','handbook_chapters','handbook_sections',
    'lessons','modules','package_content_shards','job_queue','curricula'
  ];
  v_tab text;
BEGIN
  FOR rec IN
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'fn_prebuild_%'
  LOOP
    v_def := rec.def;

    IF v_def ~* 'package_steps[^,;]*\.completed_at|UPDATE\s+package_steps[^;]*completed_at' THEN
      RETURN QUERY SELECT rec.proname::text,'WRONG_COLUMN'::text,
        'package_steps.completed_at'::text,'critical'::text,
        jsonb_build_object('hint','use finished_at on package_steps');
    END IF;

    IF v_def ~* 'UPDATE\s+package_steps[^;]*SET[^;]*[^.\w]meta\s*=\s*COALESCE\(meta' THEN
      RETURN QUERY SELECT rec.proname::text,'AMBIGUOUS_COLUMN'::text,
        'package_steps.meta'::text,'critical'::text,
        jsonb_build_object('hint','qualify meta as ps.meta');
    END IF;

    IF v_def ~* 'UPDATE\s+package_steps[^;]*status\s*=\s*''done'''
       AND v_def !~* '''ok'',\s*true' THEN
      RETURN QUERY SELECT rec.proname::text,'GUARD_VIOLATION'::text,
        'meta.ok'::text,'high'::text,
        jsonb_build_object('hint','set meta.ok=true and meta.executed=true');
    END IF;

    -- ✅ NEW: Check for unknown table references (via FROM/JOIN/INTO)
    -- e.g. catch "FROM curriculums" when correct name is "curricula"
    IF v_def ~* '\bFROM\s+curriculums\b|\bJOIN\s+curriculums\b' THEN
      RETURN QUERY SELECT rec.proname::text,'WRONG_TABLE'::text,
        'curriculums'::text,'critical'::text,
        jsonb_build_object('hint','table is "curricula" (Latin plural), not "curriculums"');
    END IF;

    -- ✅ NEW: Check for invalid blueprint_status enum values
    IF v_def ~* 'blueprint_status[^;]*''rejected''|qb\.status[^;]*=\s*''rejected''|status\s+IN\s*\([^)]*''rejected'''
    THEN
      RETURN QUERY SELECT rec.proname::text,'WRONG_ENUM_VALUE'::text,
        'blueprint_status.rejected'::text,'critical'::text,
        jsonb_build_object('hint','valid values are: approved, deprecated, draft, review');
    END IF;

    IF v_def ~* 'qb\.status[^;]*=\s*''promoted''|question_blueprints[^;]*''promoted'''
    THEN
      RETURN QUERY SELECT rec.proname::text,'WRONG_ENUM_VALUE'::text,
        'blueprint_status.promoted'::text,'critical'::text,
        jsonb_build_object('hint','question_blueprints has no "promoted" status; that is on exam_question_variants');
    END IF;
  END LOOP;

  -- Schema reference checks
  FOR rec IN
    SELECT * FROM (VALUES
      ('package_steps','finished_at'),('package_steps','meta'),('package_steps','step_key'),
      ('course_packages','curriculum_id'),
      ('question_blueprints','curriculum_id'),('question_blueprints','status'),
      ('exam_blueprints','curriculum_id'),
      ('exam_question_variants','blueprint_id'),('exam_question_variants','curriculum_id'),
      ('handbook_chapters','curriculum_id'),
      ('handbook_sections','expand_status'),('handbook_sections','quality_score'),
      ('curricula','id')
    ) AS t(tab,col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=rec.tab AND column_name=rec.col
    ) THEN
      RETURN QUERY SELECT 'SCHEMA'::text,'MISSING_COLUMN'::text,
        (rec.tab||'.'||rec.col)::text,'critical'::text,
        jsonb_build_object('table',rec.tab,'column',rec.col);
    END IF;
  END LOOP;

  -- Table existence checks for tables referenced by RPCs
  FOREACH v_tab IN ARRAY v_known_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema='public' AND table_name=v_tab) THEN
      RETURN QUERY SELECT 'SCHEMA'::text,'MISSING_TABLE'::text,
        v_tab::text,'critical'::text,
        jsonb_build_object('table',v_tab);
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_audit_prebuild_drift() TO authenticated, service_role;