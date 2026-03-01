
-- Guard: prevent any function from resetting an exception-approved step
CREATE OR REPLACE FUNCTION public.guard_exception_approved_steps()
RETURNS TRIGGER AS $$
BEGIN
  -- If the step was exception-approved and someone tries to change status away from 'done'
  IF OLD.exception_approved = true AND NEW.status != 'done' AND NEW.exception_approved = true THEN
    RAISE WARNING 'guard_exception_approved: blocked reset of exception-approved step %.% (attempted status: %)',
      OLD.package_id, OLD.step_key, NEW.status;
    -- Keep original values
    NEW.status := OLD.status;
    NEW.started_at := OLD.started_at;
    NEW.finished_at := OLD.finished_at;
    NEW.last_error := OLD.last_error;
    NEW.attempts := OLD.attempts;
  END IF;
  
  -- Also prevent clearing exception_approved without explicit intent (must set to false first)
  -- If someone sets exception_approved = false, allow the reset
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_guard_exception_approved
  BEFORE UPDATE ON public.package_steps
  FOR EACH ROW
  WHEN (OLD.exception_approved = true)
  EXECUTE FUNCTION public.guard_exception_approved_steps();

COMMENT ON TRIGGER trg_guard_exception_approved ON public.package_steps IS 
  'Prevents automated systems from resetting exception-approved steps back to queued/pending';
