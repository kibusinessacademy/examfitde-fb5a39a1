
-- SSOT Hardening v3: mini_check exclusion + ceil precision
CREATE OR REPLACE FUNCTION public.guard_publish_requires_real_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_total   int;
  v_real    int;
  v_hollow  int;
BEGIN
  IF NEW.status IS DISTINCT FROM 'published' THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM 'published' THEN RETURN NEW; END IF;

  -- Publish guard validates course-level lessons via NEW.course_id
  -- because lessons are course-scoped SSOT (modules → course_id), not package-scoped.
  -- mini_check is excluded: it is not publish-relevant learning content.

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE public.is_real_lesson_content(l.content, l.step::text)),
    COUNT(*) FILTER (WHERE public.is_hollow_lesson(l.content, l.step::text))
  INTO v_total, v_real, v_hollow
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = NEW.course_id
    AND l.step::text != 'mini_check';

  IF v_total = 0 THEN
    RAISE EXCEPTION 'PUBLISH_BLOCKED: No lessons found for course_id=% (package=%)', NEW.course_id, NEW.id;
  END IF;

  IF v_hollow > 0 THEN
    RAISE EXCEPTION 'PUBLISH_BLOCKED: % hollow lessons remain (total=%, real=%, course_id=%)',
      v_hollow, v_total, v_real, NEW.course_id;
  END IF;

  -- CEIL = strict 90% (11 lessons → min 10 real)
  IF v_real < GREATEST(1, CEIL(v_total * 0.9)::int) THEN
    RAISE EXCEPTION 'PUBLISH_BLOCKED: Only %/% lessons have real content (min 90%% required, course_id=%)',
      v_real, v_total, NEW.course_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_publish_requires_real_content() IS
  'Publish gate: blocks course_packages → published unless lessons pass SSOT quality checks. '
  'Course-scoped (not package-scoped). mini_check excluded from evaluation. '
  'Blocks: 0 lessons, any hollow, <90% real (CEIL-strict).';
