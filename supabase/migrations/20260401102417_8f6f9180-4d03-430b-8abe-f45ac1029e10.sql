-- FIX: guard_no_exam_first_track references NEW.meta which does NOT exist
-- on course_packages → causes runtime crash on every EXAM_FIRST insert/update.

CREATE OR REPLACE FUNCTION public.guard_no_exam_first_track()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.track = 'EXAM_FIRST' THEN
    -- Allow INSERTs (auto_set_track_defaults sets EXAM_FIRST as default)
    IF TG_OP = 'INSERT' THEN
      RETURN NEW;
    END IF;

    -- Allow if explicitly authorized via session variable (admin-ops service role override)
    IF current_setting('app.track_switch_authorized', true) = 'true' THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'EXAM_FIRST track is disabled for UPDATE. Use admin-ops with track_switch_authorized to override.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;