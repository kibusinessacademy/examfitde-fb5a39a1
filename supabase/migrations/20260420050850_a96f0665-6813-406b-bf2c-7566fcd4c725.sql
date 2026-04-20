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
  v_def text;
  v_required text[] := ARRAY[
    'fn_prebuild_promote_blueprint_variants',
    'fn_prebuild_generate_blueprint_variants',
    'fn_prebuild_auto_seed_exam_blueprints'
  ];
  v_fn text;
  v_target_table text;
BEGIN
  FOREACH v_fn IN ARRAY v_required LOOP
    BEGIN
      v_def := pg_get_functiondef(v_fn::regproc);
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT v_fn, 'BRIDGE_FUNCTION_MISSING'::text,
        'critical'::text, 'Funktion existiert nicht'::text;
      CONTINUE;
    END;

    v_target_table := CASE v_fn
      WHEN 'fn_prebuild_promote_blueprint_variants' THEN 'exam_questions'
      WHEN 'fn_prebuild_generate_blueprint_variants' THEN 'exam_question_variants'
      WHEN 'fn_prebuild_auto_seed_exam_blueprints' THEN 'exam_blueprints'
    END;

    IF v_def !~* ('INSERT\s+INTO\s+' || v_target_table) THEN
      RETURN QUERY SELECT v_fn, 'BRIDGE_NO_MATERIALIZATION'::text,
        'critical'::text,
        ('Bridge-RPC ohne INSERT INTO ' || v_target_table)::text;
    END IF;
  END LOOP;
END;
$function$;