-- Progress-aware Integrity Gate (DB migration)
-- 1) check_lesson_writes_in_flight(course_id, window_minutes)
-- 2) auto_recover_exhausted_content_step(package_id)

-- 1) check_lesson_writes_in_flight
CREATE OR REPLACE FUNCTION public.check_lesson_writes_in_flight(
  p_course_id uuid,
  p_window_minutes int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(mins => GREATEST(1, COALESCE(p_window_minutes, 5)));
  v_recent_writes int := 0;
  v_last_write timestamptz := NULL;
BEGIN
  SELECT
    COUNT(*),
    MAX(cv.created_at)
  INTO v_recent_writes, v_last_write
  FROM public.content_versions cv
  JOIN public.lessons l ON l.id = cv.lesson_id
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = p_course_id
    AND cv.created_at >= v_since;

  RETURN jsonb_build_object(
    'in_flight', (v_recent_writes > 0),
    'recent_writes', v_recent_writes,
    'last_write', v_last_write,
    'window_minutes', GREATEST(1, COALESCE(p_window_minutes, 5))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_lesson_writes_in_flight(uuid,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_lesson_writes_in_flight(uuid,int) TO service_role;


-- 2) auto_recover_exhausted_content_step
CREATE OR REPLACE FUNCTION public.auto_recover_exhausted_content_step(
  p_package_id uuid,
  p_ready_ratio numeric DEFAULT 0.85,
  p_min_content_chars int DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_step_status text;
  v_step_attempts int;
  v_max_attempts int;

  v_total int := 0;
  v_real int := 0;
  v_empty int := 0;
  v_threshold int := 0;

  v_recovered boolean := false;
  v_ratio numeric := 0;

  v_has_auto_heal_log boolean := false;
BEGIN
  SELECT cp.course_id INTO v_course_id
  FROM public.course_packages cp
  WHERE cp.id = p_package_id;

  IF v_course_id IS NULL THEN
    RETURN jsonb_build_object('recovered', false, 'reason', 'package_not_found');
  END IF;

  SELECT ps.status, ps.attempts, ps.max_attempts
  INTO v_step_status, v_step_attempts, v_max_attempts
  FROM public.package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.step_key = 'generate_learning_content';

  IF v_step_status IS NULL THEN
    RETURN jsonb_build_object('recovered', false, 'reason', 'step_not_found');
  END IF;

  IF v_max_attempts IS NULL OR v_max_attempts <= 0 THEN
    RETURN jsonb_build_object('recovered', false, 'reason', 'max_attempts_missing');
  END IF;

  IF v_step_attempts < v_max_attempts THEN
    RETURN jsonb_build_object(
      'recovered', false,
      'reason', 'not_exhausted',
      'attempts', v_step_attempts,
      'max_attempts', v_max_attempts
    );
  END IF;

  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (
      WHERE l.content IS NOT NULL
        AND l.content::text NOT ILIKE '%_placeholder%'
        AND (
          length(COALESCE(l.content->>'html','')) >= COALESCE(p_min_content_chars, 200)
          OR length(l.content::text) >= (COALESCE(p_min_content_chars, 200) * 2)
        )
    )::int AS real,
    COUNT(*) FILTER (
      WHERE l.content IS NULL
        OR l.content::text ILIKE '%_placeholder%'
        OR (
          length(COALESCE(l.content->>'html','')) < COALESCE(p_min_content_chars, 200)
          AND length(COALESCE(l.content::text,'')) < (COALESCE(p_min_content_chars, 200) * 2)
        )
    )::int AS empty
  INTO v_total, v_real, v_empty
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id;

  IF v_total <= 0 THEN
    RETURN jsonb_build_object('recovered', false, 'reason', 'no_lessons', 'total', 0);
  END IF;

  v_threshold := CEIL(v_total * LEAST(1, GREATEST(0, COALESCE(p_ready_ratio, 0.85))))::int;
  v_ratio := (v_real::numeric / NULLIF(v_total::numeric, 0));

  IF v_real >= v_threshold THEN
    UPDATE public.package_steps
    SET attempts = 0,
        started_at = NULL,
        finished_at = NULL,
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb)
              - 'ok' - 'batch_complete'
              || jsonb_build_object(
                   'auto_recovered_at', now(),
                   'recovery_reason', 'content_ready_despite_exhaustion',
                   'real', v_real,
                   'total', v_total,
                   'ratio', v_ratio
                 )
    WHERE package_id = p_package_id
      AND step_key = 'generate_learning_content';

    UPDATE public.course_packages
    SET status = 'building',
        last_error = NULL
    WHERE id = p_package_id
      AND status = 'failed';

    v_recovered := true;

    v_has_auto_heal_log := (to_regclass('public.auto_heal_log') IS NOT NULL);
    IF v_has_auto_heal_log THEN
      INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail)
      VALUES (
        'auto_recover_exhausted_content',
        'auto_recover_exhausted_content_step',
        'package',
        p_package_id::text,
        'healed',
        format('Content ready (%s/%s real, %s empty, ratio=%.3f) — reset exhausted step', v_real, v_total, v_empty, v_ratio)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'recovered', v_recovered,
    'package_id', p_package_id,
    'course_id', v_course_id,
    'total', v_total,
    'real', v_real,
    'still_empty', v_empty,
    'threshold', v_threshold,
    'ready_ratio', COALESCE(p_ready_ratio, 0.85),
    'min_chars', COALESCE(p_min_content_chars, 200),
    'ratio', v_ratio,
    'attempts_were', v_step_attempts,
    'max_attempts', v_max_attempts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.auto_recover_exhausted_content_step(uuid,numeric,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_recover_exhausted_content_step(uuid,numeric,int) TO service_role;