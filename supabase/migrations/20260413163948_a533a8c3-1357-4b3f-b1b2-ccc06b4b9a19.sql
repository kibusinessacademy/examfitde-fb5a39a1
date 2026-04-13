
UPDATE public.jobtype_limits SET max_processing = 3 WHERE job_type = 'package_generate_handbook';

-- Guard: prevent max_processing = 0 for generation job types in the future
CREATE OR REPLACE FUNCTION public.fn_guard_jobtype_limit_zero()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.max_processing < 1 THEN
    INSERT INTO public.admin_notifications (title, category, severity, entity_type, metadata)
    VALUES (
      'WARNUNG: jobtype_limits.max_processing auf ' || NEW.max_processing || ' für ' || NEW.job_type,
      'runner_health',
      'critical',
      'jobtype_limit',
      jsonb_build_object('job_type', NEW.job_type, 'old_value', OLD.max_processing, 'new_value', NEW.max_processing)
    );
    -- Allow but warn — don't silently block
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_jobtype_limit_zero ON public.jobtype_limits;
CREATE TRIGGER trg_guard_jobtype_limit_zero
  BEFORE UPDATE ON public.jobtype_limits
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_jobtype_limit_zero();
