
CREATE OR REPLACE FUNCTION public.get_admin_course_preview_deep_links(
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_module_id uuid;
  v_lesson_id uuid;
  v_minicheck_lesson_id uuid;
  v_blueprint_id uuid;
BEGIN
  SELECT c.id INTO v_course_id
  FROM public.courses c
  WHERE c.curriculum_id = p_curriculum_id
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF v_course_id IS NOT NULL THEN
    SELECT m.id INTO v_module_id
    FROM public.modules m
    WHERE m.course_id = v_course_id
    ORDER BY m.sort_order ASC NULLS LAST, m.created_at ASC
    LIMIT 1;
  END IF;

  IF v_module_id IS NOT NULL THEN
    SELECT l.id INTO v_lesson_id
    FROM public.lessons l
    WHERE l.module_id = v_module_id
    ORDER BY l.sort_order ASC NULLS LAST, l.created_at ASC
    LIMIT 1;
  END IF;

  IF v_course_id IS NOT NULL THEN
    SELECT l.id INTO v_minicheck_lesson_id
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id
      AND COALESCE(l.has_minicheck, false) = true
    ORDER BY m.sort_order ASC NULLS LAST, l.sort_order ASC NULLS LAST, l.created_at ASC
    LIMIT 1;
  END IF;

  SELECT eb.id INTO v_blueprint_id
  FROM public.exam_blueprints eb
  WHERE eb.curriculum_id = p_curriculum_id
    AND COALESCE(eb.frozen, false) = true
  ORDER BY eb.created_at ASC
  LIMIT 1;

  RETURN jsonb_build_object(
    'curriculum_id', p_curriculum_id,
    'course_id', v_course_id,
    'module_id', v_module_id,
    'lesson_id', v_lesson_id,
    'minicheck_lesson_id', v_minicheck_lesson_id,
    'blueprint_id', v_blueprint_id,
    'course_url', CASE WHEN v_course_id IS NOT NULL
      THEN '/learner/course/' || p_curriculum_id
      ELSE NULL END,
    'lesson_url', CASE WHEN v_lesson_id IS NOT NULL
      THEN '/lesson/' || v_lesson_id
      ELSE NULL END,
    'minicheck_url', CASE WHEN v_minicheck_lesson_id IS NOT NULL
      THEN '/lesson/' || v_minicheck_lesson_id
      ELSE NULL END,
    'exam_url', '/learner/exam/' || p_curriculum_id,
    'adaptive_exam_url', '/learner/exam/adaptive/' || p_curriculum_id,
    'oral_exam_url', '/learner/oral-exam/' || p_curriculum_id,
    'tutor_url', '/learner/tutor/' || p_curriculum_id,
    'dashboard_url', '/learner/dashboard/' || p_curriculum_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_course_preview_deep_links(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_course_preview_deep_links(uuid) TO authenticated, service_role;
