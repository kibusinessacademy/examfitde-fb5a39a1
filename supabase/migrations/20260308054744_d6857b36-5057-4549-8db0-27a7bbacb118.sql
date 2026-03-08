-- Publish gate: checks if a package is safe to publish
CREATE OR REPLACE FUNCTION public.can_publish_package(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_failed_steps int := 0;
  v_open_jobs int := 0;
  v_placeholder_lessons int := 0;
  v_hollow_lessons int := 0;
  v_tutor_ok boolean := false;
  v_exam_ok boolean := false;
  v_handbook_ok boolean := false;
  v_build_progress numeric := 0;
BEGIN
  SELECT id, course_id, status, build_progress
  INTO v_pkg
  FROM public.course_packages
  WHERE id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'package_not_found');
  END IF;

  v_build_progress := COALESCE(v_pkg.build_progress, 0);

  SELECT count(*) INTO v_failed_steps
  FROM public.package_steps
  WHERE package_id = p_package_id AND status = 'failed';

  SELECT count(*) INTO v_open_jobs
  FROM public.job_queue
  WHERE package_id = p_package_id AND status IN ('pending', 'queued', 'processing');

  SELECT count(*) INTO v_placeholder_lessons
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  JOIN public.courses c ON c.id = m.course_id
  WHERE c.id = v_pkg.course_id
    AND COALESCE(l.content->>'_placeholder', 'false') = 'true';

  SELECT count(*) INTO v_hollow_lessons
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  JOIN public.courses c ON c.id = m.course_id
  WHERE c.id = v_pkg.course_id
    AND l.content IS NOT NULL
    AND COALESCE(length(l.content->>'html'), 0) < 600
    AND COALESCE(l.step, '') <> 'mini_check';

  SELECT EXISTS (
    SELECT 1 FROM public.ai_tutor_context_index idx
    WHERE idx.package_id = p_package_id
      AND COALESCE((idx.stats->>'topics_chunks')::int, 0) > 0
      AND COALESCE((idx.stats->>'lessons_chunks')::int, 0) > 0
      AND COALESCE((idx.stats->>'handbook_chunks')::int, 0) > 0
  ) INTO v_tutor_ok;

  SELECT EXISTS (
    SELECT 1
    FROM public.exam_questions q
    JOIN public.curricula cur ON cur.id = q.curriculum_id
    JOIN public.courses c ON c.curriculum_id = cur.id
    JOIN public.course_packages cp ON cp.course_id = c.id
    WHERE cp.id = p_package_id
      AND (q.qc_status = 'approved' OR q.status = 'approved')
  ) INTO v_exam_ok;

  SELECT EXISTS (
    SELECT 1
    FROM public.handbook_sections hs
    JOIN public.handbook_chapters hc ON hc.id = hs.chapter_id
    JOIN public.curricula cur ON cur.id = hc.curriculum_id
    JOIN public.courses c ON c.curriculum_id = cur.id
    JOIN public.course_packages cp ON cp.course_id = c.id
    WHERE cp.id = p_package_id
      AND COALESCE(length(hs.content_markdown), 0) > 1000
  ) INTO v_handbook_ok;

  RETURN jsonb_build_object(
    'ok',
      v_failed_steps = 0
      AND v_open_jobs = 0
      AND v_placeholder_lessons = 0
      AND v_hollow_lessons = 0
      AND v_tutor_ok = true
      AND v_exam_ok = true
      AND v_handbook_ok = true
      AND v_build_progress >= 100,
    'failed_steps', v_failed_steps,
    'open_jobs', v_open_jobs,
    'placeholder_lessons', v_placeholder_lessons,
    'hollow_lessons', v_hollow_lessons,
    'tutor_ok', v_tutor_ok,
    'exam_ok', v_exam_ok,
    'handbook_ok', v_handbook_ok,
    'build_progress', v_build_progress
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_publish_package(uuid) TO service_role;

-- Auto-publish all ready packages in a wave
CREATE OR REPLACE FUNCTION public.publish_wave_ready_packages(p_wave_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_gate jsonb;
  v_published int := 0;
  v_skipped int := 0;
  v_blocked int := 0;
BEGIN
  FOR rec IN
    SELECT wi.id AS wave_item_id, wi.package_id, wi.status, cp.course_id
    FROM public.production_wave_items wi
    JOIN public.course_packages cp ON cp.id = wi.package_id
    WHERE wi.wave_id = p_wave_id
      AND wi.package_id IS NOT NULL
      AND wi.status IN ('quality_gate_passed', 'queued', 'building')
  LOOP
    v_gate := public.can_publish_package(rec.package_id);

    IF COALESCE((v_gate->>'ok')::boolean, false) THEN
      UPDATE public.course_packages
      SET status = 'published', published_at = now(), updated_at = now()
      WHERE id = rec.package_id;

      UPDATE public.production_wave_items
      SET status = 'published', finished_at = COALESCE(finished_at, now()),
          updated_at = now(), quality_score = 100
      WHERE id = rec.wave_item_id;

      v_published := v_published + 1;
    ELSE
      IF COALESCE((v_gate->>'failed_steps')::int, 0) > 0 THEN
        UPDATE public.production_wave_items
        SET status = 'blocked', finished_at = COALESCE(finished_at, now()),
            updated_at = now(), last_error = left(v_gate::text, 500)
        WHERE id = rec.wave_item_id;
        v_blocked := v_blocked + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'published', v_published,
    'blocked', v_blocked,
    'skipped', v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_wave_ready_packages(uuid) TO service_role;