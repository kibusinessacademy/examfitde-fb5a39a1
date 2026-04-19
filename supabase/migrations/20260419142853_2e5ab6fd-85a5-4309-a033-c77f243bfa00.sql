CREATE OR REPLACE FUNCTION public.fn_heal_ghost_completions(p_mode text DEFAULT 'detect_only'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_safe_steps text[] := ARRAY[
    'auto_seed_exam_blueprints', 'validate_blueprints',
    'generate_glossary', 'scaffold_learning_course',
    'build_ai_tutor_index', 'generate_handbook', 'validate_handbook',
    'finalize_learning_content', 'fanout_learning_content',
    'validate_learning_content', 'validate_lesson_minichecks',
    'validate_oral_exam', 'validate_tutor_index',
    'validate_handbook_depth', 'enqueue_handbook_expand',
    'elite_harden', 'validate_blueprint_variants',
    'promote_blueprint_variants'
  ];
  v_detected int := 0;
  v_healed int := 0;
  v_skipped int := 0;
  v_blocked int := 0;
  v_errors  int := 0;
  v_details jsonb[] := ARRAY[]::jsonb[];
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM v_ops_ghost_completions
    WHERE pkg_status IN ('building', 'blocked', 'quality_gate_failed')
    ORDER BY priority, package_id
  LOOP
    v_detected := v_detected + 1;
    BEGIN
      IF p_mode = 'heal_safe' AND rec.step_key = ANY(v_safe_steps) THEN
        UPDATE package_steps
        SET status = 'done',
            started_at = COALESCE(started_at, now()),
            attempts = GREATEST(attempts, 1),
            updated_at = now()
        WHERE package_id = rec.package_id
          AND step_key = rec.step_key
          AND status = 'queued';
        IF FOUND THEN
          v_healed := v_healed + 1;
          INSERT INTO system_heal_log (heal_type, package_id, step_key, job_id, details)
          VALUES ('ghost_completion', rec.package_id, rec.step_key, rec.job_id,
                  jsonb_build_object('mode', 'heal_safe', 'title', rec.title, 'track', rec.track));
        END IF;
        v_details := array_append(v_details, jsonb_build_object(
          'action', 'healed', 'step', rec.step_key, 'package', rec.package_id, 'title', rec.title));
      ELSE
        v_skipped := v_skipped + 1;
        INSERT INTO system_heal_log (heal_type, package_id, step_key, job_id, details)
        VALUES ('detect_only', rec.package_id, rec.step_key, rec.job_id,
                jsonb_build_object('mode', p_mode, 'reason',
                  CASE WHEN p_mode = 'detect_only' THEN 'detect_only_mode'
                       ELSE 'step_not_in_safe_whitelist' END,
                  'title', rec.title, 'track', rec.track));
        v_details := array_append(v_details, jsonb_build_object(
          'action', 'detected_only', 'step', rec.step_key, 'package', rec.package_id, 'title', rec.title));
      END IF;
    EXCEPTION
      WHEN raise_exception OR check_violation OR integrity_constraint_violation THEN
        v_blocked := v_blocked + 1;
        INSERT INTO system_heal_log (heal_type, package_id, step_key, job_id, details)
        VALUES ('ghost_completion_blocked', rec.package_id, rec.step_key, rec.job_id,
                jsonb_build_object('mode', p_mode, 'reason', 'guard_rejected',
                                   'sqlerrm', SQLERRM, 'title', rec.title));
        v_details := array_append(v_details, jsonb_build_object(
          'action', 'blocked_by_guard', 'step', rec.step_key, 'package', rec.package_id,
          'title', rec.title, 'sqlerrm', SQLERRM));
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        INSERT INTO system_heal_log (heal_type, package_id, step_key, job_id, details)
        VALUES ('ghost_completion_error', rec.package_id, rec.step_key, rec.job_id,
                jsonb_build_object('mode', p_mode, 'sqlstate', SQLSTATE,
                                   'sqlerrm', SQLERRM, 'title', rec.title));
        v_details := array_append(v_details, jsonb_build_object(
          'action', 'error', 'step', rec.step_key, 'package', rec.package_id,
          'sqlstate', SQLSTATE, 'sqlerrm', SQLERRM));
    END;
  END LOOP;
  RETURN jsonb_build_object('detected', v_detected, 'healed', v_healed,
    'skipped_unsafe', v_skipped, 'blocked_by_guard', v_blocked, 'errors', v_errors,
    'mode', p_mode, 'items', to_jsonb(v_details));
END;
$function$;