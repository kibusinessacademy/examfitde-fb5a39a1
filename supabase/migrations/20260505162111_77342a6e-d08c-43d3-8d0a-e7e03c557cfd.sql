CREATE OR REPLACE FUNCTION public.admin_backfill_course_skeleton(_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_course RECORD;
  v_lf RECORD;
  v_module_id uuid;
  v_lesson_id uuid;
  v_modules_created int := 0;
  v_lessons_created int := 0;
  v_package_id uuid;
  v_jobs_enqueued int := 0;
  v_lesson_ids uuid[] := ARRAY[]::uuid[];
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
      _course_id, v_lf.id, v_lf.code,
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
      'draft', 1, 'queued',
      jsonb_build_object('placeholder', true, 'source', 'admin_backfill_course_skeleton')
    )
    RETURNING id INTO v_lesson_id;
    v_lessons_created := v_lessons_created + 1;
    v_lesson_ids := array_append(v_lesson_ids, v_lesson_id);
  END LOOP;

  IF v_modules_created = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_learning_fields_for_curriculum',
                              'curriculum_id', v_course.curriculum_id);
  END IF;

  -- Resolve associated package (best-effort)
  SELECT id INTO v_package_id
  FROM public.course_packages
  WHERE course_id = _course_id
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_package_id IS NULL THEN
    SELECT id INTO v_package_id
    FROM public.course_packages
    WHERE curriculum_id = v_course.curriculum_id
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  -- Enqueue follow-up jobs so skeletons become learnable, not just visible.
  -- (1) lesson_generate_content per fresh placeholder lesson
  INSERT INTO public.job_queue (job_type, payload, status, max_attempts, package_id, meta)
  SELECT
    'lesson_generate_content',
    jsonb_build_object(
      'lesson_id', l_id,
      'course_id', _course_id,
      'curriculum_id', v_course.curriculum_id,
      'package_id', v_package_id,
      'source', 'admin_backfill_course_skeleton'
    ),
    'pending', 5, v_package_id,
    jsonb_build_object('source', 'admin_backfill_course_skeleton')
  FROM unnest(v_lesson_ids) AS l_id
  WHERE v_package_id IS NOT NULL OR true; -- always enqueue; package_id may be null
  GET DIAGNOSTICS v_jobs_enqueued = ROW_COUNT;

  -- (2) package-level minicheck generation (only if package known)
  IF v_package_id IS NOT NULL THEN
    INSERT INTO public.job_queue (job_type, payload, status, max_attempts, package_id, meta)
    VALUES (
      'package_generate_lesson_minichecks',
      jsonb_build_object(
        'package_id', v_package_id,
        'course_id', _course_id,
        'source', 'admin_backfill_course_skeleton'
      ),
      'pending', 5, v_package_id,
      jsonb_build_object('source', 'admin_backfill_course_skeleton')
    );
    v_jobs_enqueued := v_jobs_enqueued + 1;
  END IF;

  -- (3) course readiness recompute
  INSERT INTO public.job_queue (job_type, payload, status, max_attempts, package_id, meta)
  VALUES (
    'council_recompute_course_ready',
    jsonb_build_object(
      'course_id', _course_id,
      'package_id', v_package_id,
      'source', 'admin_backfill_course_skeleton'
    ),
    'pending', 3, v_package_id,
    jsonb_build_object('source', 'admin_backfill_course_skeleton')
  );
  v_jobs_enqueued := v_jobs_enqueued + 1;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'empty_course_skeleton_backfilled',
    'course', _course_id::text, 'success',
    jsonb_build_object(
      'modules_created', v_modules_created,
      'lessons_created', v_lessons_created,
      'jobs_enqueued', v_jobs_enqueued,
      'package_id', v_package_id,
      'curriculum_id', v_course.curriculum_id,
      'title', v_course.title
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'course_id', _course_id,
    'package_id', v_package_id,
    'modules_created', v_modules_created,
    'lessons_created', v_lessons_created,
    'jobs_enqueued', v_jobs_enqueued
  );
END;
$function$;