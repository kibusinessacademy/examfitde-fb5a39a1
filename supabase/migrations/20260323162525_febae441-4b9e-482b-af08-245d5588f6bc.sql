
-- Fix heal_learning_content_deadlock: content is jsonb, not text; no needs_regen column
CREATE OR REPLACE FUNCTION public.heal_learning_content_deadlock(
  p_package_id uuid DEFAULT NULL,
  p_completion_threshold numeric DEFAULT 0.95,
  p_enqueue_regen boolean DEFAULT true
)
RETURNS TABLE (
  package_id uuid,
  package_title text,
  total_lessons integer,
  generated_lessons integer,
  completion_ratio numeric,
  needs_regen_count integer,
  action_taken text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    -- Count total lessons and those with real content (jsonb content that is not null, not empty string, not '""')
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE l.content IS NOT NULL AND l.content::text NOT IN ('null', '""', '""', '') AND length(l.content::text) > 10)
    INTO v_total, v_generated
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = r.course_id;

    -- Count needs_regen: content is null/empty OR qc_status = tier1_failed
    SELECT COUNT(*)
    INTO v_needs_regen
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = r.course_id
      AND (l.content IS NULL OR l.content::text IN ('null', '""', '""', '') OR length(l.content::text) <= 10 OR l.qc_status = 'tier1_failed');

    v_ratio := CASE
      WHEN v_total > 0 THEN v_generated::numeric / v_total::numeric
      ELSE 0
    END;

    v_action := 'noop';

    IF v_total > 0 AND v_ratio >= p_completion_threshold THEN
      UPDATE public.package_steps
      SET
        status = 'done',
        finished_at = COALESCE(finished_at, now()),
        updated_at = now(),
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb)
          || jsonb_build_object(
            'healed_by', 'heal_learning_content_deadlock',
            'healed_at', now(),
            'completion_ratio', v_ratio,
            'threshold', p_completion_threshold,
            'needs_regen_count', v_needs_regen
          )
      WHERE package_id = r.id
        AND step_key = 'generate_learning_content'
        AND status IN ('queued', 'enqueued', 'running');

      UPDATE public.package_steps
      SET
        status = 'queued',
        updated_at = now(),
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb)
          || jsonb_build_object(
            'released_by', 'heal_learning_content_deadlock',
            'released_at', now()
          )
      WHERE package_id = r.id
        AND step_key IN ('finalize_learning_content', 'validate_learning_content')
        AND status IN ('queued', 'enqueued');

      IF p_enqueue_regen AND v_needs_regen > 0 THEN
        PERFORM public.enqueue_learning_content_regen_for_package(r.id, 50);
      END IF;

      v_action := 'healed_generate_and_released_downstream';
    END IF;

    package_id := r.id;
    package_title := r.title;
    total_lessons := v_total;
    generated_lessons := v_generated;
    completion_ratio := ROUND(v_ratio, 4);
    needs_regen_count := v_needs_regen;
    action_taken := v_action;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- Also fix the enqueue function: no needs_regen column on lessons
CREATE OR REPLACE FUNCTION public.enqueue_learning_content_regen_for_package(
  p_package_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH candidate_lessons AS (
    SELECT l.id AS lesson_id
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    JOIN public.courses c ON c.id = m.course_id
    JOIN public.course_packages cp ON cp.course_id = c.id
    WHERE cp.id = p_package_id
      AND (l.content IS NULL OR l.content::text IN ('null', '""', '""', '') OR length(l.content::text) <= 10 OR l.qc_status = 'tier1_failed')
    ORDER BY l.updated_at ASC NULLS FIRST, l.created_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 500))
  ),
  ins AS (
    INSERT INTO public.job_queue (
      package_id,
      job_type,
      status,
      payload,
      created_at,
      updated_at
    )
    SELECT
      p_package_id,
      'lesson_regen_repair',
      'pending',
      jsonb_build_object(
        'lesson_id', c.lesson_id,
        'reason', 'needs_regen_backfill',
        'source', 'enqueue_learning_content_regen_for_package'
      ),
      now(),
      now()
    FROM candidate_lessons c
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.job_queue jq
      WHERE jq.package_id = p_package_id
        AND jq.job_type = 'lesson_regen_repair'
        AND jq.status IN ('pending', 'processing', 'running')
        AND jq.payload->>'lesson_id' = c.lesson_id::text
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  RETURN v_inserted;
END;
$function$;
