-- Fix heal_learning_content_deadlock: don't reset finalize/validate steps that are already 'done'
CREATE OR REPLACE FUNCTION public.heal_learning_content_deadlock(
  p_package_id UUID DEFAULT NULL,
  p_completion_threshold NUMERIC DEFAULT 0.95,
  p_enqueue_regen BOOLEAN DEFAULT TRUE,
  OUT out_package_id UUID,
  OUT out_package_title TEXT,
  OUT out_total_lessons INTEGER,
  OUT out_generated_lessons INTEGER,
  OUT out_completion_ratio NUMERIC,
  OUT out_needs_regen_count INTEGER,
  OUT out_action_taken TEXT
) RETURNS SETOF RECORD LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r record;
  v_total integer;
  v_generated integer;
  v_needs_regen integer;
  v_ratio numeric;
  v_action text;
BEGIN
  FOR r IN
    SELECT cp.id, cp.title, cp.course_id
    FROM public.course_packages cp
    WHERE (p_package_id IS NULL OR cp.id = p_package_id)
      AND cp.status IN ('building', 'queued', 'blocked')
  LOOP
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE l.content IS NOT NULL AND l.content::text NOT IN ('null', '""', '') AND length(l.content::text) > 10)
    INTO v_total, v_generated
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = r.course_id;

    SELECT COUNT(*)
    INTO v_needs_regen
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = r.course_id
      AND (l.content IS NULL OR l.content::text IN ('null', '""', '') OR length(l.content::text) <= 10 OR l.qc_status = 'tier1_failed');

    v_ratio := CASE WHEN v_total > 0 THEN v_generated::numeric / v_total::numeric ELSE 0 END;
    v_action := 'noop';

    IF v_total > 0 AND v_ratio >= p_completion_threshold THEN
      -- Only heal generate_learning_content if NOT already done
      UPDATE public.package_steps ps
      SET status = 'done', finished_at = COALESCE(ps.finished_at, now()), started_at = COALESCE(ps.started_at, now()), updated_at = now(), last_error = NULL,
        meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object('healed_by', 'heal_learning_content_deadlock', 'healed_at', now(), 'completion_ratio', v_ratio, 'threshold', p_completion_threshold, 'needs_regen_count', v_needs_regen)
      WHERE ps.package_id = r.id AND ps.step_key = 'generate_learning_content' AND ps.status IN ('queued', 'enqueued', 'running');

      -- Only release downstream if they are NOT already done (prevent resetting completed steps)
      UPDATE public.package_steps ps
      SET status = 'queued', updated_at = now(), last_error = NULL,
        meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object('released_by', 'heal_learning_content_deadlock', 'released_at', now())
      WHERE ps.package_id = r.id
        AND ps.step_key IN ('finalize_learning_content', 'validate_learning_content')
        AND ps.status IN ('enqueued')  -- REMOVED 'queued' — only release enqueued steps, not already-queued or done ones
        AND ps.status != 'done';       -- Extra safety: never reset done steps

      IF p_enqueue_regen AND v_needs_regen > 0 THEN
        PERFORM public.enqueue_learning_content_regen_for_package(r.id, 50);
      END IF;

      v_action := 'healed_generate_and_released_downstream';
    END IF;

    out_package_id := r.id;
    out_package_title := r.title;
    out_total_lessons := v_total;
    out_generated_lessons := v_generated;
    out_completion_ratio := ROUND(v_ratio, 4);
    out_needs_regen_count := v_needs_regen;
    out_action_taken := v_action;
    RETURN NEXT;
  END LOOP;
END;
$$;