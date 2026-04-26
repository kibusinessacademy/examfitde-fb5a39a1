CREATE OR REPLACE FUNCTION public._admin_recheck_enqueue(
  p_job_type    text,
  p_package_id  uuid,
  p_priority    integer,
  p_payload     jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_payload jsonb;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM public.course_packages cp WHERE cp.id = p_package_id;

  -- SSOT requires curriculum_id in payload for many job types
  v_payload := COALESCE(p_payload, '{}'::jsonb)
               || jsonb_build_object(
                    'package_id', p_package_id,
                    'curriculum_id', v_curriculum_id
                  );

  PERFORM public.enqueue_job_if_absent(
    p_job_type, p_package_id, p_priority, 5, now(), v_payload
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._admin_recheck_enqueue(text, uuid, integer, jsonb) TO authenticated, service_role;