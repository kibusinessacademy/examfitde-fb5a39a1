-- Admin H5P Asset Linking RPCs

CREATE OR REPLACE FUNCTION public.admin_link_h5p_to_lesson(
  p_lesson_id uuid,
  p_content_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
  v_lesson_exists boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_lesson_id IS NULL OR p_content_id IS NULL OR length(trim(p_content_id)) = 0 THEN
    RAISE EXCEPTION 'p_lesson_id and non-empty p_content_id required';
  END IF;
  -- Basic content_id sanity: alnum + dash + underscore + slash + dot only
  IF p_content_id !~ '^[A-Za-z0-9_./-]+$' THEN
    RAISE EXCEPTION 'invalid p_content_id format';
  END IF;

  SELECT TRUE, h5p_content_id INTO v_lesson_exists, v_old
  FROM public.lessons
  WHERE id = p_lesson_id;

  IF NOT COALESCE(v_lesson_exists, FALSE) THEN
    RAISE EXCEPTION 'lesson not found: %', p_lesson_id;
  END IF;

  UPDATE public.lessons
  SET h5p_content_id = p_content_id
  WHERE id = p_lesson_id;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'admin_h5p_link', 'lesson', p_lesson_id::text, 'success',
    jsonb_build_object(
      'op', 'link',
      'old_content_id', v_old,
      'new_content_id', p_content_id,
      'actor', auth.uid()
    )
  );

  RETURN jsonb_build_object('ok', true, 'lesson_id', p_lesson_id, 'content_id', p_content_id, 'previous', v_old);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_link_h5p_to_lesson(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_h5p_to_lesson(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_unlink_h5p_from_lesson(
  p_lesson_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_lesson_id IS NULL THEN
    RAISE EXCEPTION 'p_lesson_id required';
  END IF;

  SELECT h5p_content_id INTO v_old FROM public.lessons WHERE id = p_lesson_id;

  UPDATE public.lessons
  SET h5p_content_id = NULL
  WHERE id = p_lesson_id;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'admin_h5p_link', 'lesson', p_lesson_id::text, 'success',
    jsonb_build_object('op','unlink','old_content_id', v_old, 'actor', auth.uid())
  );

  RETURN jsonb_build_object('ok', true, 'lesson_id', p_lesson_id, 'previous', v_old);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_unlink_h5p_from_lesson(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unlink_h5p_from_lesson(uuid) TO authenticated;

-- Smoke
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('admin_link_h5p_to_lesson','admin_unlink_h5p_from_lesson') AND pronamespace='public'::regnamespace) <> 2 THEN
    RAISE EXCEPTION 'h5p link RPCs not all created';
  END IF;
END $$;