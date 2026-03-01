
-- ============================================================
-- Progress-aware Integrity Gate + Auto-Recovery for Exhausted Content Steps
-- ============================================================

-- 1) Function: detect in-flight lesson writes for a course
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
  v_recent_writes int;
  v_last_write timestamptz;
BEGIN
  SELECT COUNT(*), MAX(l.updated_at)
  INTO v_recent_writes, v_last_write
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = p_course_id
    AND l.updated_at >= now() - (p_window_minutes || ' minutes')::interval;

  RETURN jsonb_build_object(
    'in_flight', v_recent_writes > 0,
    'recent_writes', v_recent_writes,
    'last_write', v_last_write,
    'window_minutes', p_window_minutes
  );
END;
$$;

-- 2) Function: auto-recover exhausted generate_learning_content step
--    if content is actually ready (lessons exist, no placeholders)
CREATE OR REPLACE FUNCTION public.auto_recover_exhausted_content_step(
  p_package_id uuid
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
  v_still_empty int;
  v_total int;
  v_real int;
  v_recovered boolean := false;
BEGIN
  -- Get course_id
  SELECT course_id INTO v_course_id
  FROM public.course_packages WHERE id = p_package_id;

  IF v_course_id IS NULL THEN
    RETURN jsonb_build_object('recovered', false, 'reason', 'package_not_found');
  END IF;

  -- Get step state
  SELECT status, attempts, max_attempts
  INTO v_step_status, v_step_attempts, v_max_attempts
  FROM public.package_steps
  WHERE package_id = p_package_id AND step_key = 'generate_learning_content';

  -- Only recover if step is queued but exhausted (attempts >= max_attempts)
  IF v_step_status IS NULL THEN
    RETURN jsonb_build_object('recovered', false, 'reason', 'step_not_found');
  END IF;

  IF v_step_attempts < v_max_attempts THEN
    RETURN jsonb_build_object('recovered', false, 'reason', 'not_exhausted', 'attempts', v_step_attempts, 'max', v_max_attempts);
  END IF;

  -- Count content state
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE
      l.content IS NOT NULL
      AND l.content->>'html' IS NOT NULL
      AND length(coalesce(l.content->>'html','')) >= 200
      AND (l.content->>'_placeholder')::text IS DISTINCT FROM 'true'
    ),
    COUNT(*) FILTER (WHERE
      l.content IS NULL
      OR l.content->>'html' IS NULL
      OR length(coalesce(l.content->>'html','')) < 200
      OR (l.content->>'_placeholder')::text = 'true'
    )
  INTO v_total, v_real, v_still_empty
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id;

  -- If >= 85% of lessons are real content, auto-recover
  IF v_total > 0 AND v_real >= CEIL(v_total * 0.85) THEN
    UPDATE public.package_steps
    SET attempts = 0,
        started_at = NULL,
        finished_at = NULL,
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb)
               - 'ok' - 'batch_complete'
               || jsonb_build_object('auto_recovered_at', now(), 'recovery_reason', 'content_ready_despite_exhaustion')
    WHERE package_id = p_package_id
      AND step_key = 'generate_learning_content';

    -- Also ensure package is still building (not failed)
    UPDATE public.course_packages
    SET status = 'building',
        last_error = NULL
    WHERE id = p_package_id
      AND status = 'failed';

    v_recovered := true;

    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail)
    VALUES (
      'auto_recover_exhausted_content',
      'auto_recover_function',
      'package',
      p_package_id::text,
      'healed',
      format('Content ready (%s/%s real, %s empty) — reset exhausted step', v_real, v_total, v_still_empty)
    );
  END IF;

  RETURN jsonb_build_object(
    'recovered', v_recovered,
    'total', v_total,
    'real', v_real,
    'still_empty', v_still_empty,
    'threshold', CEIL(v_total * 0.85),
    'attempts_were', v_step_attempts,
    'max_attempts', v_max_attempts
  );
END;
$$;

-- Grant execute to service_role only
REVOKE ALL ON FUNCTION public.check_lesson_writes_in_flight FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_lesson_writes_in_flight TO service_role;

REVOKE ALL ON FUNCTION public.auto_recover_exhausted_content_step FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_recover_exhausted_content_step TO service_role;
