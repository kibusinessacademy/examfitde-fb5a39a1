
-- Trigger: prevent generate_learning_content from being set to 'done' when broken lessons exist
-- This is the hardest possible guard — no edge code can bypass it.

CREATE OR REPLACE FUNCTION public.guard_learning_content_step_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_broken_count integer;
BEGIN
  -- Only guard generate_learning_content step transitions to 'done'
  IF NEW.step_key != 'generate_learning_content' THEN
    RETURN NEW;
  END IF;
  IF NEW.status != 'done' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'done' THEN
    RETURN NEW; -- already done, allow updates to meta etc.
  END IF;

  -- Look up course_id from package
  SELECT cp.course_id INTO v_course_id
  FROM course_packages cp
  WHERE cp.id = NEW.package_id;

  IF v_course_id IS NULL THEN
    RETURN NEW; -- no course found, allow (edge case)
  END IF;

  -- Count broken lessons (content NULL, placeholder, tier1_failed, regenerating)
  SELECT count(*) INTO v_broken_count
  FROM modules m
  JOIN lessons l ON l.module_id = m.id
  WHERE m.course_id = v_course_id
    AND (
      l.content IS NULL
      OR l.content->>'_placeholder' = 'true'
      OR l.qc_status = 'tier1_failed'
      OR l.content->>'_regenerating' = 'true'
    );

  IF v_broken_count > 0 THEN
    RAISE EXCEPTION 'GUARD_LEARNING_CONTENT_DONE: Cannot mark step done — % broken lessons remain (content NULL/placeholder/tier1_failed/regenerating)', v_broken_count;
  END IF;

  RETURN NEW;
END;
$$;

-- Bind trigger (drop first to be idempotent)
DROP TRIGGER IF EXISTS trg_guard_learning_content_step_done ON package_steps;
CREATE TRIGGER trg_guard_learning_content_step_done
  BEFORE UPDATE ON package_steps
  FOR EACH ROW
  EXECUTE FUNCTION guard_learning_content_step_done();
