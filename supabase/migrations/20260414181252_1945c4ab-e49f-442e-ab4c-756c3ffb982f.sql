
CREATE OR REPLACE FUNCTION public.fn_guard_council_session_step_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_status step_status;
BEGIN
  -- Check quality_council step status
  SELECT ps.status INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = NEW.package_id
    AND ps.step_key = 'quality_council';

  -- Allow if step is running or done (legitimate council flow)
  IF v_step_status IN ('running', 'done') THEN
    RETURN NEW;
  END IF;

  -- Block: step not ready for council sessions
  INSERT INTO auto_heal_log (action, target_id, details)
  VALUES (
    'council_session_blocked_by_step_gate',
    NEW.package_id::text,
    jsonb_build_object(
      'council_type', NEW.council_type,
      'step_status', v_step_status::text,
      'reason', 'quality_council step not running/done'
    )
  );

  RAISE WARNING '[council-step-gate] Blocked council_session for package % — quality_council step is %', 
    NEW.package_id, COALESCE(v_step_status::text, 'NOT_FOUND');

  RETURN NULL; -- silently reject
END;
$$;

CREATE TRIGGER trg_guard_council_session_step_gate
  BEFORE INSERT ON council_sessions
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_council_session_step_gate();
