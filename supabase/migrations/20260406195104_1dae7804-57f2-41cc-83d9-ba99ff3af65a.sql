
-- Trigger function: auto-normalize auto_publish step when package becomes published
CREATE OR REPLACE FUNCTION public.fn_guard_publish_step_drift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when status transitions TO 'published'
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    -- Fix any auto_publish step that is NOT done
    UPDATE package_steps
    SET status = 'done',
        finished_at = COALESCE(finished_at, now()),
        last_error = 'AUTO_HEALED: publish-step-drift-guard'
    WHERE package_id = NEW.id
      AND step_key = 'auto_publish'
      AND status <> 'done';

    IF FOUND THEN
      INSERT INTO auto_heal_log (package_id, heal_type, detail)
      VALUES (
        NEW.id,
        'publish_step_drift_guard',
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

-- Create the trigger
DROP TRIGGER IF EXISTS trg_guard_publish_step_drift ON course_packages;
CREATE TRIGGER trg_guard_publish_step_drift
  AFTER UPDATE ON course_packages
  FOR EACH ROW
  WHEN (NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published')
  EXECUTE FUNCTION fn_guard_publish_step_drift();
