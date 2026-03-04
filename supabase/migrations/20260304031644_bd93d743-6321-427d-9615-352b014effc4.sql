-- 1) Attach the publish guard trigger (function exists, trigger was never bound)
DROP TRIGGER IF EXISTS guard_publish_requires_questions ON public.course_packages;

CREATE TRIGGER guard_publish_requires_questions
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_publish_requires_questions();

-- 2) Ghost-Fail Runner Guard: prevent steps from being set to 'failed' without a reason
-- This trigger ensures last_error is always populated when status transitions to 'failed'
CREATE OR REPLACE FUNCTION guard_step_failed_requires_reason()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when status transitions TO 'failed'
  IF NEW.status = 'failed' AND (OLD.status IS DISTINCT FROM 'failed') THEN
    -- If no error reason and no attempts were made, block the transition
    IF COALESCE(NEW.attempts, 0) = 0 AND (NEW.last_error IS NULL OR NEW.last_error = '') THEN
      -- Instead of blocking, auto-set a reason so we have observability
      NEW.last_error := format('GHOST_FAIL_GUARD: status set to failed without execution (prev=%s, at=%s)', 
                               OLD.status, now()::text);
      
      INSERT INTO public.admin_notifications (title, body, severity, category, entity_type, entity_id)
      VALUES (
        format('Ghost-fail detected: %s', NEW.step_key),
        format('Package %s step %s was set to failed without attempts or error. Previous status: %s. Auto-labeled.',
               NEW.package_id::text, NEW.step_key, OLD.status),
        'warning', 'pipeline', 'course_package', NEW.package_id::text
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_step_failed_requires_reason ON public.package_steps;

CREATE TRIGGER trg_guard_step_failed_requires_reason
  BEFORE UPDATE ON public.package_steps
  FOR EACH ROW
  EXECUTE FUNCTION guard_step_failed_requires_reason();