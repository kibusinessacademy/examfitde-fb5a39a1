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
  v_steps text[] := ARRAY[
    'validate_blueprints',
    'generate_blueprint_variants',
    'validate_blueprint_variants',
    'promote_blueprint_variants'
  ];
  v_step text;
  v_rpc_map jsonb := jsonb_build_object(
    'validate_blueprints', 'fn_prebuild_validate_blueprints',
    'generate_blueprint_variants', 'fn_prebuild_generate_blueprint_variants',
    'validate_blueprint_variants', 'fn_prebuild_validate_blueprint_variants',
    'promote_blueprint_variants', 'fn_prebuild_promote_blueprint_variants'
  );
  v_sql text;
BEGIN
  FOR rec IN
    SELECT cp.id AS pkg_id, c.title AS title
    FROM course_packages cp
    JOIN curricula c ON c.id = cp.curriculum_id
    WHERE cp.status NOT IN ('archived', 'draft_only')
      AND EXISTS (
        SELECT 1 FROM package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.step_key = ANY(v_steps)
          AND ps.status != 'done'
      )
    LIMIT p_limit
  LOOP
    -- Walk DAG order
    FOREACH v_step IN ARRAY v_steps
    LOOP
      BEGIN
        v_sql := format('SELECT * FROM %I($1)', v_rpc_map->>v_step);
        FOR res IN EXECUTE v_sql USING rec.pkg_id
        LOOP
          package_id := rec.pkg_id;
          curriculum_title := rec.title;
          step_key := v_step;
          step_status := res.step_status;
          advanced := res.advanced;
          reason := res.reason;
          meta := res.meta;
          RETURN NEXT;
          -- Stop chain if blocked or noop without prereq
          EXIT WHEN res.step_status IN ('blocked', 'pending') AND NOT res.advanced;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        package_id := rec.pkg_id;
        curriculum_title := rec.title;
        step_key := v_step;
        step_status := 'error';
        advanced := false;
        reason := SQLERRM;
        meta := '{}'::jsonb;
        RETURN NEXT;
      END;
    END LOOP;
  END LOOP;
END;
$function$;

-- Verbessertes Drift-Audit (präziser - nur echte Ambiguitäten)
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
  v_has_alias boolean;
BEGIN
  FOR rec IN
    SELECT p.proname, p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'fn_prebuild_%'
    ORDER BY p.proname
  LOOP
    v_def := pg_get_functiondef(rec.oid);

    -- 1. Ambiguous meta-column (only flag if RETURNS table has 'meta' AND code uses bare meta in UPDATE)
    IF v_def ~* 'RETURNS\s+TABLE[^$]*meta\s+jsonb'
       AND v_def ~* 'UPDATE\s+package_steps[^;]*SET[^;]*[^.\w]meta\s*=' THEN
      RETURN QUERY SELECT rec.proname::text, 'AMBIGUOUS_COLUMN'::text,
        'Function returns "meta" AND uses unqualified meta in UPDATE'::text, 'critical'::text,
        'Use ps.meta or alias'::text;
    END IF;

    -- 2. Wrong column completed_at
    IF v_def ~* 'package_steps[^;]*completed_at' THEN
      RETURN QUERY SELECT rec.proname::text, 'WRONG_COLUMN'::text,
        'completed_at does not exist on package_steps'::text, 'critical'::text,
        'Use finished_at'::text;
    END IF;

    -- 3. Missing guard flags
    IF v_def ~* 'UPDATE\s+package_steps[^;]*SET[^;]*status\s*=\s*''done'''
       AND v_def !~* '''ok''\s*,\s*true' THEN
      RETURN QUERY SELECT rec.proname::text, 'MISSING_GUARD_FLAG'::text,
        'meta missing ok=true (ghost-completion guard will revert)'::text, 'high'::text,
        'Add ok:true and executed:true to meta'::text;
    END IF;

    -- 4. Wrong table (curriculums plural)
    IF v_def ~* '\sFROM\s+curriculums\s' OR v_def ~* '\sJOIN\s+curriculums\s' THEN
      RETURN QUERY SELECT rec.proname::text, 'WRONG_TABLE'::text,
        'curriculums (plural) does not exist'::text, 'critical'::text,
        'Use curricula'::text;
    END IF;

    -- 5. Invalid status enum filter on variants
    IF v_def ~* 'exam_question_variants[^;]*status[^;]*''rejected''' THEN
      RETURN QUERY SELECT rec.proname::text, 'INVALID_ENUM_FILTER'::text,
        'exam_question_variants has no status=rejected'::text, 'medium'::text,
        'Use review/approved/promoted only'::text;
    END IF;

    -- 6. Bridge missing (promote/seed must INSERT)
    IF rec.proname IN ('fn_prebuild_promote_blueprint_variants', 'fn_prebuild_auto_seed_exam_blueprints')
       AND v_def !~* 'INSERT\s+INTO' THEN
      RETURN QUERY SELECT rec.proname::text, 'MISSING_BRIDGE'::text,
        'Function only checks but never inserts target artifacts'::text, 'high'::text,
        'Add INSERT bridge'::text;
    END IF;
  END LOOP;
END;
$function$;