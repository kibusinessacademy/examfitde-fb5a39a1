CREATE OR REPLACE FUNCTION public.fn_auto_trigger_quality_gate_heal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled_jsonb jsonb;
  v_enabled boolean;
  v_pkg record;
  v_classification jsonb;
  v_action jsonb;
  v_curriculum_id uuid;
  v_healed int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_skip_reasons jsonb := '[]'::jsonb;
BEGIN
  SELECT value INTO v_enabled_jsonb FROM public.admin_settings WHERE key = 'quality_gate_auto_heal_enabled';
  v_enabled := COALESCE((v_enabled_jsonb)::text::boolean, false);
  IF NOT v_enabled THEN
    INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
    VALUES ('quality_gate_auto_heal','skipped','system','global', jsonb_build_object('reason','kill_switch_disabled'));
    RETURN jsonb_build_object('status','disabled');
  END IF;

  FOR v_pkg IN
    SELECT package_id, title, minutes_since_report, curriculum_id
    FROM public.v_quality_gate_blocked_packages
    WHERE minutes_since_report >= 60
    ORDER BY minutes_since_report DESC LIMIT 20
  LOOP
    v_classification := public.fn_classify_quality_gate_block(v_pkg.package_id);
    v_curriculum_id := v_pkg.curriculum_id;

    IF NOT (v_classification->'guards'->>'eligible_for_auto_heal')::boolean THEN
      v_skipped := v_skipped + 1;
      v_skip_reasons := v_skip_reasons || jsonb_build_object('package_id', v_pkg.package_id, 'guards', v_classification->'guards');
      CONTINUE;
    END IF;

    BEGIN
      UPDATE public.package_steps
      SET status='queued',
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'guard_state','quality_gate_heal_in_progress',
            'stall_reason_code','QUALITY_GATE_AUTO_HEAL_TRIGGERED',
            'last_guard_action','auto_reset_by_quality_gate_cron',
            'auto_heal_at', now(),
            'allow_regression', true,
            'allow_regression_by','ops_sweep'
          )
      WHERE package_id = v_pkg.package_id
        AND step_key IN ('generate_exam_pool','validate_exam_pool','quality_council','run_integrity_check','auto_publish');

      FOR v_action IN SELECT * FROM jsonb_array_elements(v_classification->'enqueue_plan') LOOP
        DECLARE v_job_type text;
        BEGIN
          v_job_type := replace(v_action->>'action','enqueue_','');
          INSERT INTO public.job_queue(package_id, job_type, status, payload, job_name)
          VALUES (
            v_pkg.package_id, v_job_type, 'pending',
            jsonb_build_object(
              'package_id', v_pkg.package_id,
              'curriculum_id', v_curriculum_id,
              'triggered_by','quality_gate_auto_heal',
              'source','auto_heal',
              'reason', v_action->>'reason',
              'exclude_deprecated_blueprints', true
            ),
            'auto_heal/' || v_pkg.package_id::text
          );
        END;
      END LOOP;

      v_healed := v_healed + 1;
      INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
      VALUES ('quality_gate_auto_heal','healed','course_package', v_pkg.package_id::text,
              jsonb_build_object('title', v_pkg.title, 'classification', v_classification, 'minutes_blocked', v_pkg.minutes_since_report));
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
      VALUES ('quality_gate_auto_heal','failed','course_package', v_pkg.package_id::text,
              jsonb_build_object('error', SQLERRM, 'classification', v_classification));
    END;
  END LOOP;

  RETURN jsonb_build_object('status','ok','healed',v_healed,'skipped',v_skipped,'failed',v_failed,'skip_reasons',v_skip_reasons);
END;
$$;