
-- Fix can_generate_exam_pool to be track-aware:
-- EXAM_FIRST packages skip content generation, so content integrity should not block them.

CREATE OR REPLACE FUNCTION public.can_generate_exam_pool(p_course_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    -- If the package is EXAM_FIRST track, skip content integrity check
    WHEN EXISTS (
      SELECT 1 FROM public.course_packages
      WHERE course_id = p_course_id
        AND track = 'EXAM_FIRST'
        AND status = 'building'
    ) THEN true
    -- Otherwise, enforce content integrity
    ELSE coalesce(
      (SELECT (placeholder_lessons = 0) AND (too_short_lessons = 0)
       FROM public.v_course_content_integrity
       WHERE course_id = p_course_id),
      false
    )
  END;
$function$;
