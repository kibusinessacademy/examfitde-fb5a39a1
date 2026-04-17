-- Add p_caller_id parameter so service-role edge functions can pass the verified admin user explicitly.
-- Backwards compatible: if p_caller_id is null, falls back to auth.uid() (legacy direct calls).
CREATE OR REPLACE FUNCTION public.admin_reset_repair_exhaustion(
  p_package_id uuid,
  p_step_keys text[] DEFAULT NULL::text[],
  p_caller_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := COALESCE(p_caller_id, auth.uid());
  v_steps_reset int := 0;
  v_jobs_reset int := 0;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  UPDATE package_steps
  SET attempts = 0,
      meta = COALESCE(meta, '{}'::jsonb)
        - 'guard_state' - 'consecutive_no_progress' - 'hard_stall_count'
        - 'reason_codes' - 'stall_reason_code' - 'last_validate_completed_at'
        || jsonb_build_object('exhaustion_reset_at', now(), 'exhaustion_reset_by', v_caller)
  WHERE package_id = p_package_id
    AND (p_step_keys IS NULL OR step_key = ANY(p_step_keys));
  GET DIAGNOSTICS v_steps_reset = ROW_COUNT;

  UPDATE job_queue
  SET status = 'pending',
      attempts = 0,
      priority = LEAST(COALESCE(priority, 100), 5),
      error = NULL,
      last_error = NULL,
      payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('is_repair', true, 'requeued_via', 'reset_exhaustion'),
      updated_at = now()
  WHERE package_id = p_package_id
    AND status IN ('failed','cancelled');
  GET DIAGNOSTICS v_jobs_reset = ROW_COUNT;

  UPDATE course_packages
  SET is_repair = true, repair_marked_at = now(), repair_marked_by = v_caller,
      repair_reason = COALESCE(repair_reason, 'reset_exhaustion'),
      blocked_reason = NULL, stuck_reason = NULL, last_progress_at = now()
  WHERE id = p_package_id;

  INSERT INTO admin_actions (user_id, action, scope, affected_ids, payload)
  VALUES (v_caller, 'reset_repair_exhaustion', 'course_package',
    ARRAY[p_package_id],
    jsonb_build_object('steps_reset', v_steps_reset, 'jobs_reset', v_jobs_reset, 'step_keys', p_step_keys));

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id,
    'steps_reset', v_steps_reset, 'jobs_reset', v_jobs_reset);
END;
$function$;