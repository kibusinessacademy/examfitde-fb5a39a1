
-- Guard: Prevent done→queued/enqueued regression on package_steps
-- This closes the loop where healers/watchdogs accidentally revert completed work.
CREATE OR REPLACE FUNCTION public.guard_step_done_regression()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only fire when status changes FROM done TO queued/enqueued
  IF OLD.status = 'done' AND NEW.status IN ('queued', 'enqueued') THEN
    -- Allow explicit opt-in via meta flag (for admin manual resets)
    IF (NEW.meta->>'allow_regression')::boolean IS TRUE THEN
      -- Clear the flag so it doesn't persist
      NEW.meta := NEW.meta - 'allow_regression';
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'STEP_DONE_REGRESSION_BLOCKED: step "%" on package "%" cannot revert from done to %. Set meta.allow_regression=true for intentional resets.',
      OLD.step_key, OLD.package_id, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

-- Fire BEFORE update so we can block or modify
CREATE TRIGGER trg_guard_step_done_regression
  BEFORE UPDATE ON public.package_steps
  FOR EACH ROW
  WHEN (OLD.status = 'done' AND NEW.status IN ('queued', 'enqueued'))
  EXECUTE FUNCTION public.guard_step_done_regression();
