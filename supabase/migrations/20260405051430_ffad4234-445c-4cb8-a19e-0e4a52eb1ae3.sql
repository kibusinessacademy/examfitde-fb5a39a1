-- Guard: only known track values may be stored in course_packages.track
CREATE OR REPLACE FUNCTION public.validate_course_package_track()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  allowed_tracks TEXT[] := ARRAY[
    'AUSBILDUNG_VOLL', 'EXAM_FIRST', 'STUDIUM',
    'FORTBILDUNG', 'ZERTIFIKAT'
  ];
BEGIN
  IF NEW.track IS NOT NULL AND NOT (NEW.track = ANY(allowed_tracks)) THEN
    RAISE EXCEPTION 'INVALID_TRACK: "%" is not a valid track. Allowed: %', NEW.track, array_to_string(allowed_tracks, ', ');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_course_package_track
  BEFORE INSERT OR UPDATE OF track ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_course_package_track();
