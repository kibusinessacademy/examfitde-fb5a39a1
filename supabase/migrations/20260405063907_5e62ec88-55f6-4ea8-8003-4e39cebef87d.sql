
CREATE OR REPLACE FUNCTION public.validate_course_package_track()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  allowed_tracks product_track[] := ARRAY[
    'AUSBILDUNG_VOLL'::product_track, 'EXAM_FIRST'::product_track, 'EXAM_FIRST_PLUS'::product_track,
    'STUDIUM'::product_track, 'FORTBILDUNG'::product_track, 'ZERTIFIKAT'::product_track
  ];
BEGIN
  IF NEW.track IS NOT NULL AND NOT (NEW.track = ANY(allowed_tracks)) THEN
    RAISE EXCEPTION 'INVALID_TRACK: "%" is not a valid track. Allowed: %', NEW.track, array_to_string(allowed_tracks::text[], ', ');
  END IF;
  RETURN NEW;
END;
$$;
