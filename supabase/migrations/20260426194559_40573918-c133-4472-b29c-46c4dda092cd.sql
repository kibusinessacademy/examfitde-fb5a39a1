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

  v_payload := COALESCE(p_payload, '{}'::jsonb)
               || jsonb_build_object(
                    'package_id', p_package_id,
                    'curriculum_id', v_curriculum_id
                  );

  BEGIN
    PERFORM public.enqueue_job_if_absent(
      p_job_type, p_package_id, p_priority, 5, now(), v_payload
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- Job already enqueued (active) — nothing to do
      NULL;
    WHEN check_violation THEN
      -- Guards (e.g. building-only) rejected it; ignore safely
      NULL;
  END;
END;
$$;