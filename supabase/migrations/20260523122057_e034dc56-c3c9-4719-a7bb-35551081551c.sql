
CREATE OR REPLACE FUNCTION public.check_lesson_progression(p_user_id uuid, p_lesson_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_module_id uuid;
  v_lesson_order int;
  v_prev_lesson_id uuid;
  v_prev_status text;
  v_prev_completed boolean;
  v_allowed boolean := true;
  v_reason text;
BEGIN
  SELECT module_id, sort_order
  INTO v_module_id, v_lesson_order
  FROM public.lessons
  WHERE id = p_lesson_id;

  IF v_module_id IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'Lesson not found');
  END IF;

  IF v_lesson_order IS NULL OR v_lesson_order <= 1 THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  SELECT l.id
  INTO v_prev_lesson_id
  FROM public.lessons l
  WHERE l.module_id = v_module_id
    AND l.sort_order < v_lesson_order
  ORDER BY l.sort_order DESC
  LIMIT 1;

  IF v_prev_lesson_id IS NULL THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  -- SSOT: lesson_outcomes (mastery) OR learning_progress.completed (step done)
  SELECT lo.status
  INTO v_prev_status
  FROM public.lesson_outcomes lo
  WHERE lo.lesson_id = v_prev_lesson_id
    AND lo.user_id = p_user_id;

  SELECT COALESCE(lp.completed, false)
  INTO v_prev_completed
  FROM public.learning_progress lp
  WHERE lp.lesson_id = v_prev_lesson_id
    AND lp.user_id = p_user_id;

  -- Allow if either signal indicates the previous step is done.
  -- Block only when there is an explicit failed mastery outcome.
  IF v_prev_status = 'not_mastered' THEN
    v_allowed := false;
    v_reason := 'Vorheriger Lernschritt nicht bestanden – bitte wiederhole den Mini-Check';
  ELSIF v_prev_status IS NULL AND COALESCE(v_prev_completed, false) = false THEN
    v_allowed := false;
    v_reason := 'Vorheriger Lernschritt noch nicht abgeschlossen';
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'previous_lesson_id', v_prev_lesson_id,
    'previous_status', v_prev_status,
    'previous_completed', COALESCE(v_prev_completed, false)
  );
END;
$function$;
