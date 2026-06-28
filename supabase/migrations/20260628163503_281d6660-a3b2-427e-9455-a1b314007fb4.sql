
-- System-callable wrapper for sellable-content-blocker-batch (Lane B)
-- Same logic as admin_demote_empty_course but without auth.uid() admin check,
-- locked down via EXECUTE grant to service_role only.
CREATE OR REPLACE FUNCTION public.admin_demote_empty_course_system(
  _course_id uuid,
  _reason text DEFAULT 'sellable_content_blocker_batch_1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_course RECORD;
  v_module_count int;
BEGIN
  SELECT id, title, status, curriculum_id INTO v_course
  FROM public.courses WHERE id = _course_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_not_found');
  END IF;
  IF v_course.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_not_published', 'status', v_course.status);
  END IF;

  SELECT COUNT(*) INTO v_module_count FROM public.modules WHERE course_id = _course_id;
  IF v_module_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_has_modules', 'modules', v_module_count);
  END IF;

  UPDATE public.courses
     SET status = 'draft', published_at = NULL, updated_at = now()
   WHERE id = _course_id;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'empty_course_demoted_to_draft',
    'course',
    _course_id::text,
    'success',
    jsonb_build_object('reason', _reason, 'title', v_course.title, 'curriculum_id', v_course.curriculum_id, 'caller', 'system')
  );

  RETURN jsonb_build_object('ok', true, 'course_id', _course_id, 'title', v_course.title, 'reason', _reason);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_demote_empty_course_system(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_demote_empty_course_system(uuid, text) TO service_role;
