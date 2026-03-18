
-- Fix 1: Extend fn_clear_stale_package_flags to also null integrity_report
CREATE OR REPLACE FUNCTION public.fn_clear_stale_package_flags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When run_integrity_check is reset away from 'done', clear integrity_passed AND report
  IF NEW.step_key = 'run_integrity_check' AND NEW.status IN ('queued','running','failed') 
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE course_packages
    SET integrity_passed = false,
        integrity_report = null,
        updated_at = now()
    WHERE id = NEW.package_id;
  END IF;

  -- When quality_council is reset away from 'done', clear council_approved
  IF NEW.step_key = 'quality_council' AND NEW.status IN ('queued','running','failed')
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE course_packages
    SET council_approved = false, updated_at = now()
    WHERE id = NEW.package_id AND council_approved = true;
  END IF;

  RETURN NEW;
END;
$$;

-- Fix 2: Trigger on course_packages itself — when status resets to planning/queued, 
-- invalidate integrity_report automatically
CREATE OR REPLACE FUNCTION public.fn_invalidate_integrity_on_package_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When package is reset to a pre-build state, null out stale report
  IF NEW.status IN ('planning', 'queued') 
     AND OLD.status NOT IN ('planning', 'queued')
     AND (OLD.integrity_report IS NOT NULL OR OLD.integrity_passed = true) THEN
    NEW.integrity_report := null;
    NEW.integrity_passed := false;
  END IF;

  -- When build_progress drops significantly (rebuild), invalidate report
  IF NEW.build_progress < OLD.build_progress - 10
     AND OLD.integrity_report IS NOT NULL THEN
    NEW.integrity_report := null;
    NEW.integrity_passed := false;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop if exists to avoid duplicate
DROP TRIGGER IF EXISTS trg_invalidate_integrity_on_package_reset ON public.course_packages;

CREATE TRIGGER trg_invalidate_integrity_on_package_reset
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_invalidate_integrity_on_package_reset();
