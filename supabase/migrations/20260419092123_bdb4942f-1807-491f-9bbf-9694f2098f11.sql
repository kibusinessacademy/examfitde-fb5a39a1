-- Drop broken 5-arg version
DROP FUNCTION IF EXISTS public.admin_manual_heal_package(uuid, text, boolean, text, integer);

-- Recreate with correct columns
CREATE OR REPLACE FUNCTION public.admin_manual_heal_package(
  p_package_id uuid,
  p_reset_from_step text,
  p_cancel_active_jobs boolean DEFAULT true,
  p_reason text DEFAULT 'manual_admin_heal',
  p_cooldown_minutes integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg            record;
  v_step_keys      text[] := ARRAY[]::text[];
  v_cancelled_jobs int := 0;
  v_reset_steps    int := 0;
  v_now            timestamptz := now();
  v_cooldown_until timestamptz;
BEGIN
  SELECT id, status, blocked_reason
    INTO v_pkg
    FROM course_packages
   WHERE id = p_package_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PACKAGE_NOT_FOUND');
  END IF;

  v_cooldown_until := v_now + make_interval(mins => GREATEST(p_cooldown_minutes, 1));

  -- 1. Cancel active jobs
  IF p_cancel_active_jobs THEN
    UPDATE job_queue
       SET status = 'cancelled',
           completed_at = v_now,
           last_error = 'admin_manual_heal: cancelled to allow re-enter',
           updated_at = v_now,
           meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
             'transition_source','admin_manual_heal',
             'transition_reason', p_reason,
             'transition_at', v_now
           )
     WHERE package_id = p_package_id
       AND status IN ('pending','queued','processing');
    GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;
  END IF;

  -- 2. Determine steps to reset (every step not done/skipped)
  SELECT array_agg(step_key) INTO v_step_keys
    FROM package_steps
   WHERE package_id = p_package_id
     AND status NOT IN ('done','skipped');

  IF v_step_keys IS NOT NULL AND array_length(v_step_keys,1) > 0 THEN
    UPDATE package_steps
       SET status = 'queued',
           attempts = 0,
           started_at = NULL,
           finished_at = NULL,
           last_error = NULL,
           runner_id = NULL,
           job_id = NULL,
           updated_at = v_now,
           meta = COALESCE(meta, '{}'::jsonb)
                  - 'repair_attempts' - 'exhausted' - 'last_repair_at'
                  || jsonb_build_object(
                    'manual_heal_at', v_now,
                    'manual_heal_reason', p_reason,
                    'manual_heal_reset_from', p_reset_from_step
                  )
     WHERE package_id = p_package_id
       AND step_key = ANY(v_step_keys);
    GET DIAGNOSTICS v_reset_steps = ROW_COUNT;
  END IF;

  -- 3. Unblock package + cooldown
  UPDATE course_packages
     SET status = CASE WHEN status IN ('blocked','failed') THEN 'building' ELSE status END,
         blocked_reason = NULL,
         blocked_by = NULL,
         blocked_at = NULL,
         stuck_reason = NULL,
         last_error = NULL,
         manual_heal_cooldown_until = v_cooldown_until,
         updated_at = v_now
   WHERE id = p_package_id;

  -- 4. Audit
  INSERT INTO admin_actions (action, scope, affected_ids, payload)
  VALUES (
    'admin_manual_heal_package',
    'package',
    ARRAY[p_package_id::text],
    jsonb_build_object(
      'reset_from_step', p_reset_from_step,
      'reason', p_reason,
      'cancel_active_jobs', p_cancel_active_jobs,
      'cancelled_jobs', v_cancelled_jobs,
      'reset_steps', v_reset_steps,
      'reset_step_keys', v_step_keys,
      'cooldown_until', v_cooldown_until,
      'cooldown_minutes', p_cooldown_minutes
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'cancelled_jobs', v_cancelled_jobs,
    'reset_steps', v_reset_steps,
    'reset_step_keys', v_step_keys,
    'cooldown_until', v_cooldown_until
  );
END;
$function$;