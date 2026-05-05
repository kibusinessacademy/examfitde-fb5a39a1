
CREATE OR REPLACE FUNCTION public.admin_didaktik_heal_packages(p_package_ids uuid[], p_bypass_bronze boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg uuid;
  v_reset int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_actor uuid := auth.uid();
  v_bronze boolean;
  v_steps_reset int;
BEGIN
  IF NOT public.has_role(v_actor,'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_package_ids IS NULL OR array_length(p_package_ids,1) IS NULL THEN
    RETURN jsonb_build_object('reset',0,'skipped',0,'results','[]'::jsonb);
  END IF;

  FOREACH v_pkg IN ARRAY p_package_ids LOOP
    SELECT COALESCE((feature_flags->'bronze'->>'locked')::boolean,false) INTO v_bronze
      FROM course_packages WHERE id=v_pkg;

    IF v_bronze AND NOT p_bypass_bronze THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object('package_id',v_pkg,'action','skipped_bronze');
      CONTINUE;
    END IF;

    UPDATE course_package_build_steps
    SET status='queued', attempts=0, last_error=NULL,
        updated_at=now(),
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'didaktik_heal_at', now(),
          'didaktik_heal_by', v_actor,
          'bypass_bronze', p_bypass_bronze)
    WHERE package_id=v_pkg
      AND status IN ('failed','blocked','pending_enqueue')
      AND step_key IN (
        'generate_handbook','validate_handbook','validate_handbook_depth','expand_handbook',
        'generate_glossary',
        'generate_lesson_minichecks','validate_lesson_minichecks',
        'generate_oral_exam','validate_oral_exam',
        'generate_exam_pool','validate_exam_pool','repair_exam_pool_quality',
        'generate_learning_content','validate_learning_content','finalize_learning_content'
      );
    GET DIAGNOSTICS v_steps_reset = ROW_COUNT;

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
    VALUES('didaktik_manual_heal','admin_ui','package', v_pkg::text,
      CASE WHEN v_steps_reset>0 THEN 'success' ELSE 'noop' END,
      jsonb_build_object('steps_reset', v_steps_reset, 'bypass_bronze', p_bypass_bronze, 'actor', v_actor));

    IF v_steps_reset>0 THEN
      v_reset := v_reset + 1;
    END IF;
    v_results := v_results || jsonb_build_object('package_id',v_pkg,'steps_reset',v_steps_reset,'bronze_locked',v_bronze);
  END LOOP;

  RETURN jsonb_build_object('reset', v_reset, 'skipped', v_skipped, 'results', v_results);
END $function$;
