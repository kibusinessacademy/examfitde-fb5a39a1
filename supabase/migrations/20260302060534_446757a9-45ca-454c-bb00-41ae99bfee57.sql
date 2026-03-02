CREATE OR REPLACE FUNCTION public.get_learning_content_progress(
  p_package_id uuid,
  p_min_chars int DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_total int := 0;
  v_real int := 0;
  v_placeholder int := 0;
BEGIN
  SELECT cp.course_id INTO v_course_id
  FROM public.course_packages cp
  WHERE cp.id = p_package_id;

  IF v_course_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'package_not_found');
  END IF;

  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (
      WHERE l.content IS NOT NULL
        AND length(l.content::text) > COALESCE(p_min_chars,200)
        AND l.content::text NOT ILIKE '%_placeholder%'
    )::int,
    COUNT(*) FILTER (
      WHERE l.content IS NULL
        OR length(l.content::text) <= COALESCE(p_min_chars,200)
        OR l.content::text ILIKE '%_placeholder%'
    )::int
  INTO v_total, v_real, v_placeholder
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id;

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'course_id', v_course_id,
    'total', v_total,
    'real', v_real,
    'placeholder', v_placeholder
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_learning_content_progress(uuid,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_learning_content_progress(uuid,int) TO service_role;