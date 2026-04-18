-- Phase 2 Härtung — Fix #2 Trigger: AFTER UPDATE Trigger ruft Hot-Loop-Quarantäne bei error-like cancelled auf
-- Ergänzt die existierende Logik in _shared/job-fail.ts (welche nur den failed-Pfad abdeckt).

CREATE OR REPLACE FUNCTION public.fn_check_quarantine_on_error_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cancel_reason text;
BEGIN
  -- Only react on transition TO cancelled
  IF NEW.status != 'cancelled' OR OLD.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Skip without package context
  IF NEW.package_id IS NULL OR NEW.job_type IS NULL THEN
    RETURN NEW;
  END IF;

  v_cancel_reason := COALESCE(NEW.meta->>'cancel_reason','');

  -- Skip harmless cancel reasons (already classified as not-a-failure)
  IF v_cancel_reason IN (
    'ssot_applicability_guard',
    'step_finalized',
    'step_finalized_job_obsoleted',
    'BLOCKED_BY_MATERIALIZATION',
    'package_exit_building',
    'package_not_executable',
    'unsigned_cancel'
  ) OR v_cancel_reason LIKE 'BLOCKED_BY_MATERIALIZATION%' THEN
    RETURN NEW;
  END IF;

  -- Skip without real last_error
  IF NEW.last_error IS NULL OR LENGTH(TRIM(NEW.last_error)) = 0 THEN
    RETURN NEW;
  END IF;

  -- Fire-and-forget Quarantäne-Check (fail-open)
  BEGIN
    PERFORM public.fn_check_hot_loop_quarantine(NEW.package_id, NEW.job_type);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Silent: never break the cancel path
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_check_quarantine_on_error_cancel ON public.job_queue;
CREATE TRIGGER trg_check_quarantine_on_error_cancel
  AFTER UPDATE OF status ON public.job_queue
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.fn_check_quarantine_on_error_cancel();