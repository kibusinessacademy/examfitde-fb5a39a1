
CREATE OR REPLACE FUNCTION public.admin_validate_step_meta_drift(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg record;
  v_step record;
  v_validated int := 0;
  v_demoted int := 0;
  v_skipped int := 0;
  v_artifact_count bigint;
  v_threshold int;
  v_action_detail text;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_required');
  END IF;

  SELECT id, curriculum_id, title FROM public.course_packages
  WHERE id = p_package_id INTO v_pkg;

  IF v_pkg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_found');
  END IF;

  FOR v_step IN
    SELECT step_key, status, meta
    FROM public.package_steps
    WHERE package_id = p_package_id
      AND status = 'done'
      AND COALESCE(meta->>'ok','false') <> 'true'
    ORDER BY step_key
  LOOP
    v_artifact_count := NULL;
    v_threshold := 1;

    CASE v_step.step_key
      WHEN 'scaffold_learning_course' THEN
        SELECT count(*) INTO v_artifact_count FROM public.modules m
        JOIN public.courses c ON c.id = m.course_id
        WHERE c.curriculum_id = v_pkg.curriculum_id;
        v_threshold := 3;
      WHEN 'fanout_learning_content','generate_learning_content','finalize_learning_content' THEN
        SELECT count(*) INTO v_artifact_count FROM public.lessons l
        JOIN public.modules m ON m.id = l.module_id
        JOIN public.courses c ON c.id = m.course_id
        WHERE c.curriculum_id = v_pkg.curriculum_id;
        v_threshold := 10;
      WHEN 'validate_learning_content' THEN
        SELECT count(*) INTO v_artifact_count FROM public.lessons l
        JOIN public.modules m ON m.id = l.module_id
        JOIN public.courses c ON c.id = m.course_id
        WHERE c.curriculum_id = v_pkg.curriculum_id
          AND COALESCE(length(l.content::text), 0) > 100;
        v_threshold := 10;
      WHEN 'expand_handbook','generate_handbook','enqueue_handbook_expand' THEN
        SELECT count(*) INTO v_artifact_count FROM public.handbook_chapters
        WHERE curriculum_id = v_pkg.curriculum_id;
        v_threshold := 3;
      WHEN 'validate_handbook','validate_handbook_depth' THEN
        SELECT count(*) INTO v_artifact_count FROM public.handbook_sections hs
        JOIN public.handbook_chapters hc ON hc.id = hs.chapter_id
        WHERE hc.curriculum_id = v_pkg.curriculum_id;
        v_threshold := 10;
      WHEN 'generate_lesson_minichecks','validate_lesson_minichecks' THEN
        SELECT count(*) INTO v_artifact_count FROM public.minicheck_questions
        WHERE curriculum_id = v_pkg.curriculum_id;
        v_threshold := 10;
      WHEN 'generate_exam_pool','validate_exam_pool','repair_exam_pool_quality' THEN
        SELECT count(*) INTO v_artifact_count FROM public.exam_questions
        WHERE curriculum_id = v_pkg.curriculum_id OR package_id = p_package_id;
        v_threshold := 20;
      WHEN 'auto_seed_exam_blueprints','validate_blueprints' THEN
        SELECT count(*) INTO v_artifact_count FROM public.exam_blueprints
        WHERE curriculum_id = v_pkg.curriculum_id OR package_id = p_package_id;
        v_threshold := 1;
      WHEN 'build_ai_tutor_index','validate_tutor_index' THEN
        SELECT count(*) INTO v_artifact_count FROM public.ai_tutor_context_index
        WHERE package_id = p_package_id;
        v_threshold := 5;
      ELSE
        v_artifact_count := NULL;
    END CASE;

    IF v_artifact_count IS NULL THEN
      v_skipped := v_skipped + 1;
      v_action_detail := format('Step %s: no validator registered → demoted', v_step.step_key);

      UPDATE public.package_steps
      SET status = 'queued',
          updated_at = now(),
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'allow_regression', true,
            'allow_regression_by', 'repair_rpc',
            'demoted_at', now(),
            'demoted_reason', 'NO_VALIDATOR_FOR_STEP_KEY',
            'validated_by', 'admin_validate_step_meta_drift'
          )
      WHERE package_id = p_package_id AND step_key = v_step.step_key;

      INSERT INTO public.auto_heal_log(
        action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
      ) VALUES (
        'STEP_DEMOTED_NEEDS_REBUILD', 'admin_validate_step_meta_drift',
        'package_step', p_package_id::text || ':' || v_step.step_key,
        'ok', v_action_detail,
        jsonb_build_object('package_id', p_package_id, 'step_key', v_step.step_key,
                           'reason', 'no_validator', 'actor', v_uid)
      );

    ELSIF v_artifact_count >= v_threshold THEN
      v_validated := v_validated + 1;
      v_action_detail := format('Step %s: validated (%s artifacts >= %s)', v_step.step_key, v_artifact_count, v_threshold);

      UPDATE public.package_steps
      SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'ok', 'true', 'executed', 'true',
            'backfilled_by', 'validated_reaudit', 'backfilled_at', now(),
            'artifact_count', v_artifact_count, 'artifact_threshold', v_threshold
          ),
          updated_at = now()
      WHERE package_id = p_package_id AND step_key = v_step.step_key;

      INSERT INTO public.auto_heal_log(
        action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
      ) VALUES (
        'STEP_META_VALIDATED_BACKFILL', 'admin_validate_step_meta_drift',
        'package_step', p_package_id::text || ':' || v_step.step_key,
        'ok', v_action_detail,
        jsonb_build_object('package_id', p_package_id, 'step_key', v_step.step_key,
                           'artifact_count', v_artifact_count, 'threshold', v_threshold, 'actor', v_uid)
      );

    ELSE
      v_demoted := v_demoted + 1;
      v_action_detail := format('Step %s: artifacts missing (%s < %s) → demoted', v_step.step_key, v_artifact_count, v_threshold);

      UPDATE public.package_steps
      SET status = 'queued',
          updated_at = now(),
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'allow_regression', true,
            'allow_regression_by', 'repair_rpc',
            'demoted_at', now(),
            'demoted_reason', 'ARTIFACTS_MISSING',
            'artifact_count', v_artifact_count,
            'artifact_threshold', v_threshold,
            'validated_by', 'admin_validate_step_meta_drift'
          )
      WHERE package_id = p_package_id AND step_key = v_step.step_key;

      INSERT INTO public.auto_heal_log(
        action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
      ) VALUES (
        'STEP_DEMOTED_NEEDS_REBUILD', 'admin_validate_step_meta_drift',
        'package_step', p_package_id::text || ':' || v_step.step_key,
        'ok', v_action_detail,
        jsonb_build_object('package_id', p_package_id, 'step_key', v_step.step_key,
                           'artifact_count', v_artifact_count, 'threshold', v_threshold, 'actor', v_uid)
      );
    END IF;
  END LOOP;

  IF (v_demoted + v_skipped) > 0 THEN
    UPDATE public.course_packages
    SET status = 'building', updated_at = now()
    WHERE id = p_package_id AND status = 'done' AND published_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'package_id', p_package_id,
    'validated', v_validated, 'demoted', v_demoted,
    'skipped_no_validator', v_skipped, 'evaluated_at', now()
  );
END;
$function$;

-- Also patch reaper so it sets allow_regression markers when re-arming pending_enqueue steps
CREATE OR REPLACE FUNCTION public.admin_repair_done_with_open_steps(p_cap integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cap int := GREATEST(1, LEAST(COALESCE(p_cap,50), 500));
  v_repaired int := 0;
  v_pkg record;
  v_open_keys text[];
  v_open_count int;
BEGIN
  FOR v_pkg IN
    SELECT cp.id, cp.title
    FROM public.course_packages cp
    WHERE cp.status = 'done'
      AND cp.published_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.status NOT IN ('done','skipped')
      )
    ORDER BY cp.updated_at ASC
    LIMIT v_cap
  LOOP
    SELECT array_agg(step_key ORDER BY step_key), count(*)
    INTO v_open_keys, v_open_count
    FROM public.package_steps
    WHERE package_id = v_pkg.id
      AND status NOT IN ('done','skipped');

    UPDATE public.course_packages
    SET status = 'building', updated_at = now()
    WHERE id = v_pkg.id AND status = 'done' AND published_at IS NULL;

    UPDATE public.package_steps
    SET status = 'queued',
        updated_at = now(),
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'allow_regression', true,
          'allow_regression_by', 'repair_rpc',
          'rearmed_at', now(),
          'rearmed_reason', 'PACKAGE_STATUS_REPAIRED_FROM_DONE_TO_BUILDING'
        )
    WHERE package_id = v_pkg.id AND status = 'pending_enqueue';

    INSERT INTO public.auto_heal_log(
      action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
    ) VALUES (
      'PACKAGE_STATUS_REPAIRED_FROM_DONE_TO_BUILDING', 'reaper_done_open_steps',
      'course_package', v_pkg.id::text, 'ok',
      format('Package %s demoted to building; %s open steps', v_pkg.id, v_open_count),
      jsonb_build_object('package_id', v_pkg.id, 'package_title', v_pkg.title,
                         'open_step_count', v_open_count, 'affected_step_keys', to_jsonb(v_open_keys))
    );

    v_repaired := v_repaired + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cap', v_cap, 'repaired', v_repaired, 'evaluated_at', now());
END;
$function$;
