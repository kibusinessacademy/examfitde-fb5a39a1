
-- =============================================================================
-- fn_guard_integrity_enqueue_upstream — Audit-Mirror nach auto_heal_log
-- Lehre 2026-05-13: Guard droppte stumm (RETURN NULL) und loggte nur in
-- ops_guardrail_events. Heal-Cockpits & per-package Audit-Queries sahen den
-- Drop nicht → bronze_no_report_reconcile meldete "enqueued: success", aber
-- job_queue blieb leer. Mirror schließt die Sichtbarkeitslücke.
-- Pattern: BEGIN/EXCEPTION-Wrap, kann den Guard niemals blockieren.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_guard_integrity_enqueue_upstream()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_upstream_not_ready boolean;
  v_open_steps jsonb;
BEGIN
  IF NEW.job_type != 'package_run_integrity_check' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('cancelled', 'failed', 'completed', 'done') THEN
    RETURN NEW;
  END IF;

  -- Welche Upstream-Steps sind offen? (für Audit-Detail)
  SELECT jsonb_agg(jsonb_build_object('step_key', ps.step_key, 'status', ps.status))
  INTO v_open_steps
  FROM package_steps ps
  WHERE ps.package_id = NEW.package_id
    AND ps.step_key IN (
      'validate_exam_pool',
      'validate_blueprints',
      'validate_blueprint_variants',
      'promote_blueprint_variants',
      'repair_exam_pool_quality',
      'validate_oral_exam',
      'validate_lesson_minichecks',
      'validate_handbook',
      'validate_handbook_depth'
    )
    AND ps.status NOT IN ('done', 'skipped');

  v_upstream_not_ready := v_open_steps IS NOT NULL AND jsonb_array_length(v_open_steps) > 0;

  IF v_upstream_not_ready THEN
    -- SSOT bleibt ops_guardrail_events
    PERFORM public.fn_log_guardrail_event(
      'integrity_enqueue_blocked',
      jsonb_build_object(
        'package_id', NEW.package_id,
        'reason', 'upstream_validation_steps_not_complete',
        'job_type', NEW.job_type,
        'open_upstream_steps', v_open_steps,
        'enqueue_source', NEW.payload->>'enqueue_source',
        'bronze_lock_override', COALESCE((NEW.payload->>'bronze_lock_override')::boolean, false)
      )
    );

    -- Heal-Mirror nach auto_heal_log (best-effort, blockt Guard nie)
    BEGIN
      INSERT INTO public.auto_heal_log(
        action_type, trigger_source, target_type, target_id,
        result_status, result_detail, metadata
      ) VALUES (
        'job_queue_insert_suppressed_integrity_upstream_not_ready',
        'fn_guard_integrity_enqueue_upstream',
        'package',
        COALESCE(NEW.package_id::text, 'unknown'),
        'skipped',
        'package_run_integrity_check dropped: upstream validation steps not done',
        jsonb_build_object(
          'reason', 'UPSTREAM_VALIDATION_NOT_COMPLETE',
          'job_type', NEW.job_type,
          'package_id', NEW.package_id,
          'enqueue_source', NEW.payload->>'enqueue_source',
          'bronze_lock_override', COALESCE((NEW.payload->>'bronze_lock_override')::boolean, false),
          'open_upstream_steps', v_open_steps,
          'mirror_of', 'ops_guardrail_events.integrity_enqueue_blocked'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- niemals den Guard wegen Mirror-Failure verlieren
      NULL;
    END;

    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_guard_integrity_enqueue_upstream() IS
'BEFORE INSERT job_queue Guard für package_run_integrity_check: dropped wenn Upstream-Validations offen. SSOT: ops_guardrail_events.integrity_enqueue_blocked. Heal-Mirror: auto_heal_log.job_queue_insert_suppressed_integrity_upstream_not_ready. Mirror BEGIN/EXCEPTION-safe.';
