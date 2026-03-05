
-- Recreate guard function + trigger (original migration partially failed)
CREATE OR REPLACE FUNCTION public.guard_no_exam_first_track()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.track = 'EXAM_FIRST' THEN
    -- Allow if explicitly authorized (admin-ops service role override)
    IF (NEW.meta IS NOT NULL AND (NEW.meta->>'_track_switch_authorized')::boolean = true) THEN
      NEW.meta := NEW.meta - '_track_switch_authorized';
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'EXAM_FIRST track is disabled. All packages must use AUSBILDUNG_VOLL. Use admin-ops with _track_switch_authorized to override.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_no_exam_first ON public.course_packages;
CREATE TRIGGER trg_guard_no_exam_first
BEFORE INSERT OR UPDATE OF track ON public.course_packages
FOR EACH ROW
EXECUTE FUNCTION public.guard_no_exam_first_track();
