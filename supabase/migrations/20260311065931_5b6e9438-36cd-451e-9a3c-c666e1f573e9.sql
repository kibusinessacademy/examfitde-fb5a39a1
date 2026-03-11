
-- Reactive guard: When lessons get tier1_failed, reset generate_learning_content step
-- This closes the timing gap where validate runs AFTER the step was marked done
CREATE OR REPLACE FUNCTION reconcile_learning_step_on_tier1_fail()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_package_id uuid;
  v_step_status text;
BEGIN
  -- Only react to qc_status changing TO tier1_failed
  IF NEW.qc_status IS DISTINCT FROM 'tier1_failed' THEN
    RETURN NEW;
  END IF;
  IF OLD.qc_status IS NOT DISTINCT FROM 'tier1_failed' THEN
    RETURN NEW; -- already was tier1_failed, no change
  END IF;

  -- Find the package for this lesson's course
  SELECT cp.id INTO v_package_id
  FROM modules m
  JOIN course_packages cp ON cp.course_id = m.course_id
  WHERE m.id = NEW.module_id
    AND cp.status IN ('building', 'blocked')
  ORDER BY cp.created_at DESC
  LIMIT 1;

  IF v_package_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if generate_learning_content is currently 'done'
  SELECT ps.status INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = v_package_id
    AND ps.step_key = 'generate_learning_content';

  IF v_step_status = 'done' THEN
    -- Reset to queued so the generator picks up tier1_failed lessons
    UPDATE package_steps
    SET status = 'queued', 
        last_error = format('Auto-reset: lesson %s marked tier1_failed', NEW.id),
        started_at = NULL,
        finished_at = NULL
    WHERE package_id = v_package_id
      AND step_key = 'generate_learning_content'
      AND status = 'done';

    RAISE LOG 'reconcile_learning_step: reset generate_learning_content for package % (lesson % → tier1_failed)', 
      v_package_id, NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Attach to lessons table
DROP TRIGGER IF EXISTS trg_reconcile_learning_step_on_tier1_fail ON lessons;
CREATE TRIGGER trg_reconcile_learning_step_on_tier1_fail
  AFTER UPDATE OF qc_status ON lessons
  FOR EACH ROW
  EXECUTE FUNCTION reconcile_learning_step_on_tier1_fail();
