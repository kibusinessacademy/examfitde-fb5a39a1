-- Publish-Guard for courses: prevent publishing empty/incomplete learner courses.
-- Blocks transition to status='published' unless course has curriculum_id + ≥1 module + ≥1 lesson.
-- Bypass only via session GUC: set_config('app.transition_source','admin_force_publish',true).
-- Every block is audited in auto_heal_log.

CREATE OR REPLACE FUNCTION public.fn_guard_course_publish_readiness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_module_count int;
  v_lesson_count int;
  v_source text;
  v_missing text[] := ARRAY[]::text[];
BEGIN
  -- Only fire on transitions INTO 'published'
  IF NEW.status IS DISTINCT FROM 'published' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

  -- Count modules + lessons for this course
  SELECT COUNT(*) INTO v_module_count
    FROM public.modules WHERE course_id = NEW.id;
  SELECT COUNT(*) INTO v_lesson_count
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
   WHERE m.course_id = NEW.id;

  IF NEW.curriculum_id IS NULL THEN
    v_missing := array_append(v_missing, 'curriculum_id');
  END IF;
  IF v_module_count = 0 THEN
    v_missing := array_append(v_missing, 'modules');
  END IF;
  IF v_lesson_count = 0 THEN
    v_missing := array_append(v_missing, 'lessons');
  END IF;

  IF array_length(v_missing, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Bypass via session GUC
  v_source := current_setting('app.transition_source', true);

  IF v_source = 'admin_force_publish' THEN
    INSERT INTO public.auto_heal_log (
      action_type, trigger_source, target_type, target_id, result_status, metadata
    ) VALUES (
      'course_publish_readiness_bypassed',
      'fn_guard_course_publish_readiness',
      'course',
      NEW.id::text,
      'bypassed',
      jsonb_build_object(
        'modules', v_module_count,
        'lessons', v_lesson_count,
        'curriculum_id', NEW.curriculum_id,
        'missing', v_missing,
        'source', v_source
      )
    );
    RETURN NEW;
  END IF;

  -- Block + audit
  INSERT INTO public.auto_heal_log (
    action_type, trigger_source, target_type, target_id, result_status, metadata
  ) VALUES (
    'course_publish_readiness_blocked',
    'fn_guard_course_publish_readiness',
    'course',
    NEW.id::text,
    'blocked',
    jsonb_build_object(
      'modules', v_module_count,
      'lessons', v_lesson_count,
      'curriculum_id', NEW.curriculum_id,
      'missing', v_missing,
      'source', COALESCE(v_source, 'unknown')
    )
  );

  RAISE EXCEPTION 'COURSE_PUBLISH_READINESS_BLOCKED: course % missing %', NEW.id, v_missing
    USING ERRCODE = 'check_violation',
          HINT = 'Set app.transition_source=admin_force_publish to bypass (admin only).';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_course_publish_readiness ON public.courses;
CREATE TRIGGER trg_guard_course_publish_readiness
  BEFORE INSERT OR UPDATE OF status ON public.courses
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_course_publish_readiness();

COMMENT ON FUNCTION public.fn_guard_course_publish_readiness() IS
  'Publish-Guard v1: blocks publishing a course without curriculum_id, modules, or lessons. Bypass via session GUC app.transition_source=admin_force_publish. Every block + bypass audited in auto_heal_log (action_type=course_publish_readiness_blocked|bypassed).';