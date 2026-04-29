DROP FUNCTION IF EXISTS public._admin_recheck_enqueue(text, uuid, integer, jsonb);

CREATE OR REPLACE FUNCTION public._admin_recheck_enqueue(
  p_job_type text,
  p_package_id uuid,
  p_priority int,
  p_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_curriculum_id uuid;
  v_payload jsonb;
  v_lane text;
  v_id uuid;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  v_payload := COALESCE(p_payload, '{}'::jsonb)
               || jsonb_build_object('package_id', p_package_id);
  IF v_curriculum_id IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('curriculum_id', v_curriculum_id);
  END IF;

  v_lane := CASE
    WHEN p_job_type LIKE 'package_repair_exam_pool%' THEN 'generation'
    ELSE 'control'
  END;

  INSERT INTO public.job_queue (
    job_type, package_id, payload, status, priority, max_attempts,
    run_after, lane, meta, created_at, updated_at
  )
  SELECT
    p_job_type, p_package_id, v_payload, 'pending', p_priority, 5,
    now(), v_lane,
    jsonb_build_object(
      'origin', 'targeted_blocker_recheck',
      'enqueued_by', 'admin_targeted_blocker_recheck'
    ),
    now(), now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.job_queue jq
    WHERE jq.package_id = p_package_id
      AND jq.job_type = p_job_type
      AND jq.status IN ('pending','queued','processing','running','batch_pending')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN check_violation THEN
    RETURN NULL;
END;
$$;