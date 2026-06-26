
CREATE OR REPLACE FUNCTION public.admin_force_rebuild_package(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prev_status text;
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT status INTO v_prev_status FROM public.course_packages WHERE id = p_package_id;
  IF v_prev_status IS NULL THEN
    RAISE EXCEPTION 'package_not_found';
  END IF;

  UPDATE public.course_packages
     SET status = 'queued',
         build_progress = 0,
         integrity_passed = false,
         council_approved = false,
         council_approved_at = NULL,
         updated_at = now()
   WHERE id = p_package_id;

  -- Best-effort: clear stale steps so workers pick them up cleanly
  BEGIN
    UPDATE public.package_steps
       SET status = 'pending',
           attempts = 0,
           started_at = NULL,
           finished_at = NULL,
           last_error = NULL,
           updated_at = now()
     WHERE package_id = p_package_id
       AND status IN ('failed','blocked','error','cancelled');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Audit
  BEGIN
    INSERT INTO public.auto_heal_log (
      package_id, action_type, batch_id, payload, success, created_at
    ) VALUES (
      p_package_id,
      'admin_force_rebuild',
      'admin_force_rebuild_' || to_char(now(),'YYYY_MM_DD'),
      jsonb_build_object(
        'previous_status', v_prev_status,
        'requested_by', v_uid,
        'requested_at', now()
      ),
      true,
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'previous_status', v_prev_status,
    'new_status', 'queued'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_force_rebuild_package(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_force_rebuild_package(uuid) FROM anon, public;
