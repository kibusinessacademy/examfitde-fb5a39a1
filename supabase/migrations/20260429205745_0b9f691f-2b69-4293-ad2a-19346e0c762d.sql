CREATE OR REPLACE FUNCTION public.fn_auto_cancel_jobs_on_package_exit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_cancelled int := 0;
  v_deferred int := 0;
  v_gate_class text;
  v_has_artifacts boolean;
BEGIN
  IF OLD.status = 'building' AND NEW.status IS DISTINCT FROM 'building' THEN

    IF NEW.status = 'queued' THEN RETURN NEW; END IF;

    v_gate_class := COALESCE(NEW.gate_class, 'unknown');

    IF NEW.status = 'quality_gate_failed' AND v_gate_class = 'recoverable' THEN
      NEW.status := 'building';
      NEW.gate_class := 'recoverable';
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('qgf_bounce_prevented', NEW.id, 'run_integrity_check',
              jsonb_build_object('blocked_transition', 'building→quality_gate_failed',
                                 'gate_class', v_gate_class,
                                 'reason', 'recoverable failures do not allow package termination'));
      RETURN NEW;
    END IF;

    -- ARTIFACT-AWARE DEFER für Tail-Step-Jobs
    v_has_artifacts := public.package_has_approved_artifacts(NEW.id);

    IF v_has_artifacts THEN
      -- Tail-Step-Jobs auf retry_scheduled (+30 min) statt cancelled.
      -- job_queue nutzt run_after als Zeitplan-Spalte; scheduled_for existiert nur in email_delivery_queue.
      WITH deferred AS (
        UPDATE job_queue jq
        SET status = 'retry_scheduled',
            run_after = now() + interval '30 minutes',
            last_error = format('TAIL_STEP_DEFERRED: package %s→%s, artifacts present, retryable in 30min', OLD.status, NEW.status),
            updated_at = now(),
            locked_at = NULL,
            locked_by = NULL,
            meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
              'defer_reason', 'TAIL_STEP_RETRYABLE_WITH_ARTIFACTS',
              'transition_source', 'fn_auto_cancel_jobs_on_package_exit',
              'transition_prev_status', jq.status,
              'transition_at', now()::text,
              'old_pkg_status', OLD.status,
              'new_pkg_status', NEW.status
            )
        WHERE jq.package_id = NEW.id
          AND jq.status IN ('pending', 'batch_pending')
          AND public.is_tail_step_job_type(jq.job_type)
        RETURNING jq.id
      )
      SELECT count(*) INTO v_deferred FROM deferred;

      IF v_deferred > 0 THEN
        INSERT INTO public.auto_heal_log
          (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES (
          'tail_step_retryable_deferred',
          'fn_auto_cancel_jobs_on_package_exit',
          'course_package',
          NEW.id::text,
          'deferred',
          format('Deferred %s tail-step jobs (artifacts present) on transition %s→%s',
                 v_deferred, OLD.status, NEW.status),
          jsonb_build_object(
            'package_id', NEW.id,
            'deferred_count', v_deferred,
            'old_status', OLD.status,
            'new_status', NEW.status,
            'gate_class', v_gate_class,
            'defer_reason', 'TAIL_STEP_RETRYABLE_WITH_ARTIFACTS'
          )
        );
      END IF;
    END IF;

    -- Original-Cancel für NICHT-Tail-Steps (oder ohne Artefakte)
    WITH cancelled AS (
      UPDATE job_queue jq
      SET status = 'cancelled',
          last_error = format('AUTO_CANCEL: package status changed %s → %s (gate_class=%s)', OLD.status, NEW.status, v_gate_class),
          completed_at = now(),
          updated_at = now(),
          locked_at = NULL,
          locked_by = NULL,
          meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
            'cancel_reason', 'package_exit_building',
            'transition_source', 'fn_auto_cancel_jobs_on_package_exit',
            'transition_prev_status', jq.status,
            'transition_at', now()::text,
            'old_pkg_status', OLD.status,
            'new_pkg_status', NEW.status
          )
      FROM job_type_policies jtp
      WHERE jtp.job_type = jq.job_type
        AND jq.package_id = NEW.id
        AND jq.status IN ('pending', 'batch_pending')
        AND NOT COALESCE(jtp.exempt_from_auto_cancel, false)
        AND NOT (v_has_artifacts AND public.is_tail_step_job_type(jq.job_type))
      RETURNING jq.id
    )
    SELECT count(*) INTO v_cancelled FROM cancelled;

    WITH cancelled_unknown AS (
      UPDATE job_queue jq
      SET status = 'cancelled',
          last_error = format('AUTO_CANCEL: package status changed %s → %s (gate_class=%s)', OLD.status, NEW.status, v_gate_class),
          completed_at = now(),
          updated_at = now(),
          locked_at = NULL,
          locked_by = NULL,
          meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
            'cancel_reason', 'package_exit_building',
            'transition_source', 'fn_auto_cancel_jobs_on_package_exit',
            'transition_prev_status', jq.status,
            'transition_at', now()::text,
            'old_pkg_status', OLD.status,
            'new_pkg_status', NEW.status
          )
      WHERE jq.package_id = NEW.id
        AND jq.status IN ('pending', 'batch_pending')
        AND NOT EXISTS (SELECT 1 FROM job_type_policies p WHERE p.job_type = jq.job_type AND p.exempt_from_auto_cancel)
        AND NOT (v_has_artifacts AND public.is_tail_step_job_type(jq.job_type))
      RETURNING jq.id
    )
    SELECT v_cancelled + count(*) INTO v_cancelled FROM cancelled_unknown;

    IF v_cancelled > 0 THEN
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('auto_cancel_on_exit', NEW.id, NULL,
              jsonb_build_object('cancelled_count', v_cancelled,
                                 'deferred_tail_count', v_deferred,
                                 'old_status', OLD.status,
                                 'new_status', NEW.status,
                                 'gate_class', v_gate_class,
                                 'has_artifacts', v_has_artifacts));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;