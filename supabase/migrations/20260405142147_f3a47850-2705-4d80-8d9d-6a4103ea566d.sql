
CREATE OR REPLACE FUNCTION public.assert_step_backbone(p_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_missing text[];
  v_inserted int := 0;
  v_step text;
  v_mandatory text[] := ARRAY[
    'scaffold_learning_course','generate_glossary','fanout_learning_content',
    'generate_learning_content','finalize_learning_content','validate_learning_content',
    'auto_seed_exam_blueprints','validate_blueprints',
    'generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants',
    'generate_exam_pool','validate_exam_pool',
    'generate_lesson_minichecks','validate_lesson_minichecks',
    'generate_handbook','validate_handbook',
    'enqueue_handbook_expand','expand_handbook','validate_handbook_depth',
    'generate_oral_exam','validate_oral_exam',
    'build_ai_tutor_index','validate_tutor_index',
    'elite_harden','run_integrity_check','quality_council','auto_publish'
  ];
BEGIN
  SELECT array_agg(m.step_key)
  INTO v_missing
  FROM unnest(v_mandatory) AS m(step_key)
  LEFT JOIN package_steps ps ON ps.package_id = p_package_id AND ps.step_key = m.step_key
  WHERE ps.step_key IS NULL;

  IF v_missing IS NULL OR array_length(v_missing, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'missing', 0);
  END IF;

  FOREACH v_step IN ARRAY v_missing LOOP
    INSERT INTO package_steps (package_id, step_key, status, created_at, updated_at, meta)
    VALUES (p_package_id, v_step, 'queued', now(), now(), 
            jsonb_build_object('backfilled_by', 'assert_step_backbone', 'backfilled_at', now()::text))
    ON CONFLICT (package_id, step_key) DO NOTHING;
    v_inserted := v_inserted + 1;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('backbone_backfill', 'assert_step_backbone', 'package', p_package_id::text, 'healed',
          format('Inserted %s missing steps: %s', v_inserted, array_to_string(v_missing, ', ')),
          jsonb_build_object('missing_steps', to_jsonb(v_missing), 'count', v_inserted));

  RETURN jsonb_build_object('ok', true, 'missing', array_length(v_missing, 1), 'inserted', v_inserted, 'steps', to_jsonb(v_missing));
END;
$function$;
