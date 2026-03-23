
-- =========================================================
-- 1. Helper: determine whether a status change is a real regression
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_is_real_step_regression(
  p_old_status text,
  p_new_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_old_status = 'done'
    AND p_new_status IN ('queued', 'enqueued', 'failed');
$$;

-- =========================================================
-- 2. Harden cascade trigger: only cascade on real regression
-- =========================================================
CREATE OR REPLACE FUNCTION public.cascade_reset_downstream_steps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_pkg uuid;
  v_step text;
  v_should_cascade boolean := false;
BEGIN
  v_pkg := NEW.package_id;
  v_step := NEW.step_key;

  -- Only cascade if there is a real regression (done -> queued/enqueued/failed)
  v_should_cascade := public.fn_is_real_step_regression(OLD.status::text, NEW.status::text);

  IF NOT v_should_cascade THEN
    RETURN NEW;
  END IF;

  -- generate_learning_content regression invalidates finalize + validate
  IF v_step = 'generate_learning_content' THEN
    UPDATE public.package_steps
    SET
      status = 'queued',
      started_at = NULL,
      finished_at = NULL,
      updated_at = v_now,
      last_error = NULL,
      meta = COALESCE(meta, '{}'::jsonb)
        || jsonb_build_object(
          'cascade_reset_at', v_now,
          'cascade_reset_by_step', v_step,
          'cascade_reset_from_status', status
        )
    WHERE package_id = v_pkg
      AND step_key IN ('finalize_learning_content', 'validate_learning_content')
      AND status <> 'queued';
  END IF;

  -- finalize regression invalidates validate
  IF v_step = 'finalize_learning_content' THEN
    UPDATE public.package_steps
    SET
      status = 'queued',
      started_at = NULL,
      finished_at = NULL,
      updated_at = v_now,
      last_error = NULL,
      meta = COALESCE(meta, '{}'::jsonb)
        || jsonb_build_object(
          'cascade_reset_at', v_now,
          'cascade_reset_by_step', v_step,
          'cascade_reset_from_status', status
        )
    WHERE package_id = v_pkg
      AND step_key IN ('validate_learning_content')
      AND status <> 'queued';
  END IF;

  RETURN NEW;
END;
$function$;

-- Ensure trigger exists cleanly
DROP TRIGGER IF EXISTS trg_cascade_reset_downstream_steps ON public.package_steps;

CREATE TRIGGER trg_cascade_reset_downstream_steps
AFTER UPDATE OF status ON public.package_steps
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.cascade_reset_downstream_steps();

-- =========================================================
-- 3. Queue helper for needs_regen rework
-- =========================================================
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
      AND (COALESCE(l.needs_regen, false) = true OR l.content IS NULL OR l.qc_status = 'tier1_failed')
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

-- =========================================================
-- 4. Heal stuck validate packages where upstream is materially complete
-- =========================================================
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
    SELECT COUNT(*), COUNT(*) FILTER (WHERE COALESCE(NULLIF(BTRIM(l.content), ''), '') <> '')
    INTO v_total, v_generated
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = r.course_id;

    SELECT COUNT(*)
    INTO v_needs_regen
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = r.course_id
      AND (COALESCE(l.needs_regen, false) = true OR l.content IS NULL OR l.qc_status = 'tier1_failed');

    v_ratio := CASE
      WHEN v_total > 0 THEN v_generated::numeric / v_total::numeric
      ELSE 0
    END;

    v_action := 'noop';

    IF v_total > 0 AND v_ratio >= p_completion_threshold THEN
      -- mark generate as done if still blocked in queued/enqueued/running
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

      -- release finalize and validate if stuck
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

-- =========================================================
-- 5. Diagnostic view for deadlock candidates
-- =========================================================
CREATE OR REPLACE VIEW public.ops_learning_content_deadlock_candidates AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status AS package_status,
  ps_gen.status AS generate_status,
  ps_fin.status AS finalize_status,
  ps_val.status AS validate_status,
  ps_val.meta->>'cascade_reset_from_status' AS validate_cascade_from_status,
  ps_val.meta->>'cascade_reset_at' AS validate_cascade_reset_at
FROM public.course_packages cp
JOIN public.package_steps ps_gen
  ON ps_gen.package_id = cp.id AND ps_gen.step_key = 'generate_learning_content'
JOIN public.package_steps ps_fin
  ON ps_fin.package_id = cp.id AND ps_fin.step_key = 'finalize_learning_content'
JOIN public.package_steps ps_val
  ON ps_val.package_id = cp.id AND ps_val.step_key = 'validate_learning_content'
WHERE cp.status IN ('building', 'queued', 'blocked')
  AND ps_val.status IN ('queued', 'enqueued');

-- Restrict diagnostic view to service_role
REVOKE SELECT ON public.ops_learning_content_deadlock_candidates FROM anon, authenticated;
