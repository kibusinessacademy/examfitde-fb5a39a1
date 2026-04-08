
CREATE OR REPLACE FUNCTION fn_guard_publish_step_drift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    UPDATE package_steps
    SET status = 'done',
        finished_at = COALESCE(finished_at, now()),
        last_error = 'AUTO_HEALED: publish-step-drift-guard'
    WHERE package_id = NEW.id
      AND step_key = 'auto_publish'
      AND status <> 'done';

    IF FOUND THEN
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail)
      VALUES (
        'fn_guard_publish_step_drift',
        'publish_step_drift_guard',
        NEW.id::text,
        'course_package',
        'success',
        jsonb_build_object(
          'trigger', 'fn_guard_publish_step_drift',
          'old_status', OLD.status,
          'new_status', NEW.status,
          'action', 'auto_publish step normalized to done'
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
