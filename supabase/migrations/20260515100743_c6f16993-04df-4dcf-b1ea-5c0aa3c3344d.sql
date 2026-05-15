CREATE OR REPLACE FUNCTION public.fn_auto_trigger_quality_gate_heal()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_enabled_jsonb jsonb;
  v_enabled boolean;
  v_pkg record;
  v_classification jsonb;
  v_action_row record;
  v_curriculum_id uuid;
  v_job_type text;
  v_job_name text;
  v_new_id uuid;
  v_rc int;
  v_healed int := 0;
  v_silent_drops int := 0;
  v_failed int := 0;
  v_candidates_total int := 0;
  v_eligible_total int := 0;
  v_selected_total int := 0;
  v_skipped_rate_limited int := 0;
  v_skipped_active_repair int := 0;
  v_skipped_not_due int := 0;
  v_skipped_other int := 0;
  v_select_cap int := 20;
  v_guards jsonb;
  v_active int;
  v_recent int;
BEGIN
  SELECT value INTO v_enabled_jsonb FROM public.admin_settings WHERE key = 'quality_gate_auto_heal_enabled';
  v_enabled := COALESCE(
    CASE
      WHEN v_enabled_jsonb IS NULL THEN false
      WHEN jsonb_typeof(v_enabled_jsonb) = 'boolean' THEN (v_enabled_jsonb #>> '{}')::boolean
      WHEN jsonb_typeof(v_enabled_jsonb) = 'string'  THEN (v_enabled_jsonb #>> '{}')::boolean
      ELSE false
    END,
    false
  );

  IF NOT v_enabled THEN
    INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
    VALUES ('quality_gate_auto_heal','skipped','system','global', jsonb_build_object('reason','kill_switch_disabled'));
    RETURN jsonb_build_object('status','disabled');
  END IF;

  -- Phase 1: scan ALL blocked packages, classify, count eligibility, then process up to v_select_cap eligible (oldest first)
  FOR v_pkg IN
    SELECT package_id, title, minutes_since_report, curriculum_id
    FROM public.v_quality_gate_blocked_packages
    ORDER BY minutes_since_report DESC
  LOOP
    v_candidates_total := v_candidates_total + 1;

    IF v_pkg.minutes_since_report < 60 THEN
      v_skipped_not_due := v_skipped_not_due + 1;
      CONTINUE;
    END IF;

    v_classification := public.fn_classify_quality_gate_block(v_pkg.package_id);
    v_guards := v_classification->'guards';
    v_active := COALESCE((v_guards->>'active_repair_jobs')::int, 0);
    v_recent := COALESCE((v_guards->>'recent_auto_heals_24h')::int, 0);

    IF NOT COALESCE((v_guards->>'eligible_for_auto_heal')::boolean, false) THEN
      IF v_recent >= 3 THEN
        v_skipped_rate_limited := v_skipped_rate_limited + 1;
      ELSIF v_active > 0 THEN
        v_skipped_active_repair := v_skipped_active_repair + 1;
      ELSE
        v_skipped_other := v_skipped_other + 1;
      END IF;
      CONTINUE;
    END IF;

    v_eligible_total := v_eligible_total + 1;

    -- Cap: process only first v_select_cap eligible
    IF v_selected_total >= v_select_cap THEN
      CONTINUE;  -- keep counting eligible_total for audit visibility
    END IF;

    v_selected_total := v_selected_total + 1;
    v_curriculum_id := v_pkg.curriculum_id;

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
        AND step_key = 'generate_exam_pool';

      UPDATE public.package_steps
      SET status='pending_enqueue',
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'reset_by','quality_gate_auto_heal',
            'reset_at', now(),
            'allow_regression', true,
            'allow_regression_by','ops_sweep'
          )
      WHERE package_id = v_pkg.package_id
        AND step_key IN ('validate_exam_pool','quality_council','run_integrity_check','auto_publish');

      FOR v_action_row IN
        SELECT value
        FROM jsonb_array_elements(v_classification->'enqueue_plan') AS t(value)
        ORDER BY (value->>'priority')::int NULLS LAST
        LIMIT 1
      LOOP
        v_job_type := v_action_row.value->>'job_type';
        v_job_name := 'auto_heal/' || v_pkg.package_id::text || '/' || v_job_type;
        v_new_id := NULL;

        INSERT INTO public.job_queue(package_id, job_type, status, payload, job_name)
        VALUES (
          v_pkg.package_id,
          v_job_type,
          'pending',
          jsonb_build_object(
            'package_id', v_pkg.package_id,
            'curriculum_id', v_curriculum_id,
            'triggered_by','quality_gate_auto_heal',
            'source','auto_heal',
            'is_repair', true,
            'mode', 'targeted',
            'reason', v_action_row.value->>'reason',
            'priority', v_action_row.value->>'priority',
            'exclude_deprecated_blueprints', true
          ),
          v_job_name
        )
        RETURNING id INTO v_new_id;

        GET DIAGNOSTICS v_rc = ROW_COUNT;

        IF v_rc = 1 AND v_new_id IS NOT NULL THEN
          v_healed := v_healed + 1;
          INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
          VALUES (
            'quality_gate_auto_heal','healed','course_package', v_pkg.package_id::text,
            jsonb_build_object(
              'package_title', v_pkg.title,
              'classification', v_classification,
              'minutes_blocked', v_pkg.minutes_since_report,
              'enqueued_job_type', v_job_type,
              'enqueued_job_id', v_new_id,
              'enqueued_job_name', v_job_name,
              'rowcount', v_rc
            )
          );
        ELSE
          v_silent_drops := v_silent_drops + 1;
          INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
          VALUES (
            'quality_gate_auto_heal','skipped_silent_drop','course_package', v_pkg.package_id::text,
            jsonb_build_object(
              'reason','insert_returned_no_row',
              'package_id', v_pkg.package_id,
              'package_title', v_pkg.title,
              'planned_job_type', v_job_type,
              'planned_job_name', v_job_name,
              'rowcount', v_rc,
              'returned_id_null', (v_new_id IS NULL),
              'classification', v_classification,
              'hint','BEFORE-INSERT trigger likely returned NULL without audit mirror'
            )
          );
        END IF;
      END LOOP;

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
      VALUES ('quality_gate_auto_heal','failed','course_package', v_pkg.package_id::text,
              jsonb_build_object(
                'error', SQLERRM,
                'sqlstate', SQLSTATE,
                'planned_job_type', v_job_type,
                'planned_job_name', v_job_name,
                'classification', v_classification
              ));
    END;
  END LOOP;

  -- Run-Summary audit
  INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
  VALUES (
    'quality_gate_auto_heal_run',
    CASE WHEN v_failed > 0 THEN 'partial' ELSE 'ok' END,
    'system','global',
    jsonb_build_object(
      'candidates_total', v_candidates_total,
      'eligible_total', v_eligible_total,
      'selected_total', v_selected_total,
      'select_cap', v_select_cap,
      'healed', v_healed,
      'silent_drops', v_silent_drops,
      'failed', v_failed,
      'skipped_rate_limited', v_skipped_rate_limited,
      'skipped_active_repair', v_skipped_active_repair,
      'skipped_not_due', v_skipped_not_due,
      'skipped_other', v_skipped_other,
      'fairness','eligible_first_oldest_unhealed'
    )
  );

  RETURN jsonb_build_object(
    'status','ok',
    'candidates_total', v_candidates_total,
    'eligible_total', v_eligible_total,
    'selected_total', v_selected_total,
    'healed', v_healed,
    'silent_drops', v_silent_drops,
    'failed', v_failed,
    'skipped_rate_limited', v_skipped_rate_limited,
    'skipped_active_repair', v_skipped_active_repair,
    'skipped_not_due', v_skipped_not_due,
    'skipped_other', v_skipped_other
  );
END;
$function$;