
-- Fix: Only show published courses in learner dashboard
CREATE OR REPLACE FUNCTION public.get_dashboard_summary(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_requesting_uid uuid;
  v_result jsonb;
BEGIN
  v_requesting_uid := auth.uid();
  IF v_requesting_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_requesting_uid <> p_user_id THEN
    IF NOT public.has_role(v_requesting_uid, 'admin') THEN
      RAISE EXCEPTION 'Access denied: cannot query another user''s data';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'enrollments', COALESCE(jsonb_agg(
      jsonb_build_object(
        'course_id', e.course_id,
        'enrolled_at', e.enrolled_at,
        'last_accessed_at', e.last_accessed_at,
        'completed_at', e.completed_at,
        'curriculum_id', c.curriculum_id,
        'title', c.title,
        'description', c.description,
        'thumbnail_url', c.thumbnail_url,
        'estimated_duration', c.estimated_duration,
        'total_lessons', COALESCE(lc.total, 0),
        'completed_lessons', COALESCE(lc.done, 0)
      )
    ) FILTER (WHERE e.course_id IS NOT NULL), '[]'::jsonb),
    'active_curriculum_id', (
      SELECT c2.curriculum_id
      FROM course_enrollments e2
      JOIN courses c2 ON c2.id = e2.course_id
      WHERE e2.user_id = p_user_id
        AND e2.completed_at IS NULL
        AND c2.status = 'published'
      ORDER BY COALESCE(e2.last_accessed_at, e2.enrolled_at) DESC
      LIMIT 1
    )
  )
  INTO v_result
  FROM course_enrollments e
  JOIN courses c ON c.id = e.course_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::integer AS total,
      COUNT(*) FILTER (WHERE lp.completed = true)::integer AS done
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    LEFT JOIN learning_progress lp ON lp.lesson_id = l.id AND lp.user_id = p_user_id
    WHERE m.course_id = e.course_id
  ) lc ON true
  WHERE e.user_id = p_user_id
    AND c.status = 'published';

  RETURN COALESCE(v_result, jsonb_build_object('enrollments', '[]'::jsonb, 'active_curriculum_id', NULL));
END;
$function$;
