-- Trigger: Clear stuck_reason when package resumes active status
CREATE OR REPLACE FUNCTION fn_clear_stuck_reason_on_resume()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When a package transitions INTO building/queued and previously had a stuck_reason,
  -- clear it automatically to prevent stale informational flags
  IF NEW.status IN ('building', 'queued') 
     AND NEW.stuck_reason IS NOT NULL
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.stuck_reason IS DISTINCT FROM NEW.stuck_reason)
  THEN
    -- Only clear if this is NOT the same transaction setting stuck_reason
    -- (i.e., the status just changed to building/queued from something else)
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      NEW.stuck_reason := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_stuck_reason_on_resume ON course_packages;
CREATE TRIGGER trg_clear_stuck_reason_on_resume
  BEFORE UPDATE ON course_packages
  FOR EACH ROW
  WHEN (NEW.status IN ('building', 'queued'))
  EXECUTE FUNCTION fn_clear_stuck_reason_on_resume()