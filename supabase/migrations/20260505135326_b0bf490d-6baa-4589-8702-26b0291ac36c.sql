
-- ============================================================================
-- Empty-Published-Courses Ratchet: classify → demote (draft) | backfill skeleton
-- ============================================================================

-- 1) Classification view (admin-only)
CREATE OR REPLACE VIEW public.v_admin_empty_published_courses AS
WITH empty_courses AS (
  SELECT c.id, c.title, c.curriculum_id, c.status, c.published_at, c.created_at
  FROM public.courses c
  WHERE c.status = 'published'
    AND NOT EXISTS (SELECT 1 FROM public.modules m WHERE m.course_id = c.id)
)
SELECT
  e.id,
  e.title,
  e.curriculum_id,
  e.published_at,
  e.created_at,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.courses c2
      WHERE c2.id <> e.id
        AND c2.curriculum_id = e.curriculum_id
        AND c2.status = 'published'
        AND EXISTS (SELECT 1 FROM public.modules m WHERE m.course_id = c2.id)
    ) THEN 'duplicate_curriculum'
    WHEN EXISTS (
      SELECT 1 FROM public.courses c2
      WHERE c2.id <> e.id
        AND lower(trim(c2.title)) = lower(trim(e.title))
        AND EXISTS (SELECT 1 FROM public.modules m WHERE m.course_id = c2.id)
    ) THEN 'duplicate_title'
    WHEN e.curriculum_id IS NULL THEN 'no_curriculum_phantom'
    WHEN EXISTS (
      SELECT 1 FROM public.learning_fields lf WHERE lf.curriculum_id = e.curriculum_id
    ) THEN 'backfill_candidate'
    ELSE 'unknown'
  END AS cluster,
  (SELECT COUNT(*) FROM public.learning_fields lf WHERE lf.curriculum_id = e.curriculum_id) AS source_learning_fields,
  (SELECT COUNT(*) FROM public.exam_questions eq WHERE eq.curriculum_id = e.curriculum_id) AS source_exam_questions
FROM empty_courses e;

REVOKE ALL ON public.v_admin_empty_published_courses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_empty_published_courses TO service_role;

-- 2) Admin RPC: list empty published courses (admin-gated)
CREATE OR REPLACE FUNCTION public.admin_get_empty_published_courses()
RETURNS TABLE (
  id uuid,
  title text,
  curriculum_id uuid,
  cluster text,
  source_learning_fields bigint,
  source_exam_questions bigint,
  published_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT v.id, v.title, v.curriculum_id, v.cluster,
           v.source_learning_fields, v.source_exam_questions,
           v.published_at, v.created_at
    FROM public.v_admin_empty_published_courses v
    ORDER BY v.cluster, v.title;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_empty_published_courses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_empty_published_courses() TO authenticated, service_role;

-- 3) Admin RPC: demote an empty/duplicate course back to draft
CREATE OR REPLACE FUNCTION public.admin_demote_empty_course(
  _course_id uuid,
  _reason text DEFAULT 'empty_published_ratchet'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course RECORD;
  v_module_count int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT id, title, status, curriculum_id INTO v_course
  FROM public.courses WHERE id = _course_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_not_found');
  END IF;
  IF v_course.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_not_published', 'status', v_course.status);
  END IF;

  SELECT COUNT(*) INTO v_module_count FROM public.modules WHERE course_id = _course_id;
  IF v_module_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_has_modules', 'modules', v_module_count);
  END IF;

  UPDATE public.courses
     SET status = 'draft', published_at = NULL, updated_at = now()
   WHERE id = _course_id;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'empty_course_demoted_to_draft',
    'course',
    _course_id::text,
    'success',
    jsonb_build_object('reason', _reason, 'title', v_course.title, 'curriculum_id', v_course.curriculum_id)
  );

  RETURN jsonb_build_object('ok', true, 'course_id', _course_id, 'title', v_course.title, 'reason', _reason);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_demote_empty_course(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_demote_empty_course(uuid, text) TO authenticated, service_role;

-- 4) Admin RPC: backfill module/lesson skeleton from curriculum's learning_fields
CREATE OR REPLACE FUNCTION public.admin_backfill_course_skeleton(_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course RECORD;
  v_lf RECORD;
  v_module_id uuid;
  v_modules_created int := 0;
  v_lessons_created int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT id, title, curriculum_id, status INTO v_course
  FROM public.courses WHERE id = _course_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_not_found');
  END IF;
  IF v_course.curriculum_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_has_no_curriculum');
  END IF;
  IF EXISTS (SELECT 1 FROM public.modules WHERE course_id = _course_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_already_has_modules');
  END IF;

  FOR v_lf IN
    SELECT id, code, title, sort_order
    FROM public.learning_fields
    WHERE curriculum_id = v_course.curriculum_id
    ORDER BY sort_order NULLS LAST, code NULLS LAST, title
  LOOP
    INSERT INTO public.modules (course_id, learning_field_id, learning_field_code, title, description, sort_order)
    VALUES (
      _course_id,
      v_lf.id,
      v_lf.code,
      COALESCE(NULLIF(v_lf.title, ''), 'Lernfeld ' || COALESCE(v_lf.code, '?')),
      'Automatisch generiertes Modul (Skelett) – Inhalte werden ergänzt.',
      COALESCE(v_lf.sort_order, v_modules_created + 1)
    )
    RETURNING id INTO v_module_id;
    v_modules_created := v_modules_created + 1;

    INSERT INTO public.lessons (module_id, title, step, status, sort_order, generation_status, content)
    VALUES (
      v_module_id,
      'Einstieg: ' || COALESCE(NULLIF(v_lf.title, ''), 'Lernfeld'),
      'einstieg'::text::lesson_step,
      'draft',
      1,
      'queued',
      jsonb_build_object('placeholder', true, 'source', 'admin_backfill_course_skeleton')
    );
    v_lessons_created := v_lessons_created + 1;
  END LOOP;

  IF v_modules_created = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_learning_fields_for_curriculum',
                              'curriculum_id', v_course.curriculum_id);
  END IF;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'empty_course_skeleton_backfilled',
    'course',
    _course_id::text,
    'success',
    jsonb_build_object(
      'modules_created', v_modules_created,
      'lessons_created', v_lessons_created,
      'curriculum_id', v_course.curriculum_id,
      'title', v_course.title
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'course_id', _course_id,
    'modules_created', v_modules_created,
    'lessons_created', v_lessons_created
  );
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_backfill_course_skeleton(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_backfill_course_skeleton(uuid) TO authenticated, service_role;

COMMENT ON VIEW public.v_admin_empty_published_courses IS
  'Empty published courses with cluster classification (duplicate / phantom / backfill_candidate). Admin-only.';
COMMENT ON FUNCTION public.admin_demote_empty_course IS
  'Admin: move an empty published course back to draft + audit log. Refuses if modules exist.';
COMMENT ON FUNCTION public.admin_backfill_course_skeleton IS
  'Admin: create module-per-learning-field + placeholder einstieg lesson for an empty course. Idempotent: refuses if modules exist.';
