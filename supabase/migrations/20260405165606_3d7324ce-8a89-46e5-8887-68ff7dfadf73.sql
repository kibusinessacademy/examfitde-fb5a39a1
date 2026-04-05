
DROP FUNCTION IF EXISTS public.get_admin_auto_test_queue(integer);
DROP FUNCTION IF EXISTS public.get_admin_auto_test_queue;
DROP FUNCTION IF EXISTS public.get_admin_course_test_priority();
DROP FUNCTION IF EXISTS public.record_admin_course_test_run(uuid, uuid, text, text, text[]);
DROP FUNCTION IF EXISTS public.get_admin_course_test_run_latest();
DROP FUNCTION IF EXISTS public.get_admin_course_test_run_history(uuid);
DROP FUNCTION IF EXISTS public.get_admin_published_course_preview();
DROP FUNCTION IF EXISTS public.get_admin_course_preview_deep_links(uuid);
DROP FUNCTION IF EXISTS public.get_package_content_progress(uuid);

CREATE FUNCTION public.get_admin_auto_test_queue(p_limit int DEFAULT 10)
RETURNS SETOF v_admin_auto_test_queue_v2
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM v_admin_auto_test_queue_v2 ORDER BY queue_score DESC LIMIT p_limit; $$;

CREATE FUNCTION public.get_admin_course_test_priority()
RETURNS SETOF v_admin_course_test_priority
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM v_admin_course_test_priority ORDER BY test_priority ASC, updated_at DESC; $$;

CREATE FUNCTION public.record_admin_course_test_run(
  p_package_id uuid, p_curriculum_id uuid, p_test_status text,
  p_notes text DEFAULT NULL, p_issue_codes text[] DEFAULT '{}'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO admin_course_test_runs (package_id, curriculum_id, tested_by, test_status, notes, issue_codes)
  VALUES (p_package_id, p_curriculum_id, auth.uid(), p_test_status, p_notes, p_issue_codes)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE FUNCTION public.get_admin_course_test_run_latest()
RETURNS SETOF v_admin_course_test_run_latest
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM v_admin_course_test_run_latest; $$;

CREATE FUNCTION public.get_admin_course_test_run_history(p_package_id uuid)
RETURNS SETOF admin_course_test_runs
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM admin_course_test_runs WHERE package_id = p_package_id ORDER BY created_at DESC LIMIT 50; $$;

CREATE FUNCTION public.get_admin_published_course_preview()
RETURNS SETOF v_admin_published_course_preview
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM v_admin_published_course_preview; $$;

CREATE FUNCTION public.get_admin_course_preview_deep_links(p_curriculum_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_course_id uuid; v_module_id uuid; v_lesson_id uuid; v_blueprint_id uuid;
BEGIN
  SELECT c.id INTO v_course_id FROM courses c WHERE c.curriculum_id = p_curriculum_id LIMIT 1;
  SELECT m.id INTO v_module_id FROM course_modules m WHERE m.course_id = v_course_id ORDER BY m.sort_order ASC LIMIT 1;
  SELECT l.id INTO v_lesson_id FROM course_lessons l WHERE l.module_id = v_module_id ORDER BY l.sort_order ASC LIMIT 1;
  SELECT b.id INTO v_blueprint_id FROM exam_blueprints b WHERE b.curriculum_id = p_curriculum_id LIMIT 1;
  RETURN json_build_object(
    'curriculum_id', p_curriculum_id, 'course_id', v_course_id, 'module_id', v_module_id,
    'lesson_id', v_lesson_id, 'minicheck_lesson_id', v_lesson_id, 'blueprint_id', v_blueprint_id,
    'course_url', CASE WHEN v_course_id IS NOT NULL THEN '/kurse/' || v_course_id ELSE NULL END,
    'lesson_url', CASE WHEN v_lesson_id IS NOT NULL THEN '/kurse/' || v_course_id || '/lektion/' || v_lesson_id ELSE NULL END,
    'minicheck_url', CASE WHEN v_lesson_id IS NOT NULL THEN '/kurse/' || v_course_id || '/minicheck/' || v_lesson_id ELSE NULL END,
    'exam_url', '/pruefungssimulation/' || p_curriculum_id,
    'adaptive_exam_url', '/adaptive-pruefung/' || p_curriculum_id,
    'oral_exam_url', '/muendliche-pruefung/' || p_curriculum_id,
    'tutor_url', '/tutor/' || p_curriculum_id,
    'dashboard_url', '/dashboard'
  );
END; $$;

CREATE FUNCTION public.get_package_content_progress(p_package_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_course_id uuid; v_total_lessons int; v_content_lessons int;
  v_total_blueprints int; v_approved_questions int; v_handbook_sections int;
BEGIN
  SELECT cp.course_id INTO v_course_id FROM course_packages cp WHERE cp.id = p_package_id;
  SELECT count(*) INTO v_total_lessons FROM course_lessons cl JOIN course_modules cm ON cm.id = cl.module_id WHERE cm.course_id = v_course_id;
  SELECT count(*) INTO v_content_lessons FROM course_lessons cl JOIN course_modules cm ON cm.id = cl.module_id WHERE cm.course_id = v_course_id AND cl.content IS NOT NULL AND cl.content != '';
  SELECT count(*) INTO v_total_blueprints FROM exam_blueprints eb JOIN course_packages cp ON cp.curriculum_id = eb.curriculum_id WHERE cp.id = p_package_id;
  SELECT count(*) INTO v_approved_questions FROM exam_questions eq JOIN exam_blueprints eb ON eb.id = eq.blueprint_id JOIN course_packages cp ON cp.curriculum_id = eb.curriculum_id WHERE cp.id = p_package_id AND eq.status = 'approved';
  SELECT count(*) INTO v_handbook_sections FROM handbook_sections hs WHERE hs.package_id = p_package_id;
  RETURN json_build_object('total_lessons', v_total_lessons, 'content_lessons', v_content_lessons, 'total_blueprints', v_total_blueprints, 'approved_questions', v_approved_questions, 'handbook_sections', v_handbook_sections);
END; $$;
