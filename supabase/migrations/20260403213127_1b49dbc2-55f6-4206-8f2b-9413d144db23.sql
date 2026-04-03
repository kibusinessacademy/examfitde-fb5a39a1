
CREATE OR REPLACE FUNCTION public.guard_ghost_step_finalization()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only guard transitions TO 'done' (not 'failed' — steps can fail before starting)
  IF NEW.status != 'done' THEN RETURN NEW; END IF;
  -- Allow metadata updates on already-done steps
  IF OLD.status = 'done' AND NEW.status = 'done' THEN RETURN NEW; END IF;

  -- Dispatcher-driven steps: external orchestrator updates meta but doesn't set started_at.
  IF NEW.step_key IN ('generate_learning_content') THEN RETURN NEW; END IF;

  -- Block if step was never started (started_at IS NULL)
  -- Exception: steps explicitly approved via exception_approved
  IF NEW.started_at IS NULL AND NOT COALESCE(NEW.exception_approved, false) THEN
    RAISE EXCEPTION 'GHOST_FINALIZATION_BLOCKED: step "%" cannot be marked "%" — started_at IS NULL, attempts=%, package=%',
      NEW.step_key, NEW.status, NEW.attempts, NEW.package_id;
  END IF;

  RETURN NEW;
END;
$function$;
