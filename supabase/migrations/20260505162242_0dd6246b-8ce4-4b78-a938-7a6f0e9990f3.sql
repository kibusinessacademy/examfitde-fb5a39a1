CREATE OR REPLACE FUNCTION public.admin_force_publish_course_for_test(_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.transition_source', 'admin_force_publish', true);

  UPDATE public.courses SET status = 'published' WHERE id = _course_id
  RETURNING status INTO v_status;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'course_id', _course_id, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_force_publish_course_for_test(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_publish_course_for_test(uuid) TO service_role;