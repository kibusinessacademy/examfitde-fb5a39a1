
CREATE OR REPLACE FUNCTION guard_package_publish_requires_didaktik()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_learning boolean;
  has_minichecks boolean;
  has_handbook boolean;
  didaktik_steps int;
  lesson_count int;
  pkg_track text;
BEGIN
  IF (TG_OP = 'UPDATE') AND (NEW.status = 'published') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    pkg_track := COALESCE(NEW.track, 'AUSBILDUNG_VOLL');
    
    -- EXAM_FIRST and EXAM_FIRST_PLUS tracks skip didaktik checks
    IF pkg_track IN ('EXAM_FIRST', 'EXAM_FIRST_PLUS') THEN
      RETURN NEW;
    END IF;

    has_learning := COALESCE((NEW.feature_flags->>'has_learning_course')::boolean, false);
    has_minichecks := COALESCE((NEW.feature_flags->>'has_minichecks')::boolean, false);
    has_handbook := COALESCE((NEW.feature_flags->>'has_handbook')::boolean, false);

    SELECT COUNT(*) INTO didaktik_steps
    FROM public.package_steps ps
    WHERE ps.package_id = NEW.id
      AND ps.step_key IN ('scaffold_learning_course','generate_learning_content','generate_lesson_minichecks','generate_handbook')
      AND ps.status = 'done';

    SELECT COUNT(*) INTO lesson_count
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    JOIN public.courses c ON c.id = m.course_id
    WHERE c.id = NEW.course_id;

    IF (NOT has_learning) OR (NOT has_minichecks) OR (NOT has_handbook) THEN
      RAISE EXCEPTION 'GUARD_PUBLISH_DIDAKTIK_FLAGS_MISSING: package=% track=% has_learning=% has_minichecks=% has_handbook=%',
        NEW.id, pkg_track, has_learning, has_minichecks, has_handbook
        USING ERRCODE = 'P0001';
    END IF;

    IF didaktik_steps < 4 THEN
      RAISE EXCEPTION 'GUARD_PUBLISH_DIDAKTIK_STEPS_INCOMPLETE: package=% done_steps=%/4',
        NEW.id, didaktik_steps
        USING ERRCODE = 'P0001';
    END IF;

    IF lesson_count <= 0 THEN
      RAISE EXCEPTION 'GUARD_PUBLISH_NO_LESSONS: package=% lesson_count=0',
        NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
