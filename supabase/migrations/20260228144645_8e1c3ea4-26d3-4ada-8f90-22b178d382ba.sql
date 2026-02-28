
-- Hard gate: prevent publishing packages with 0 approved questions
CREATE OR REPLACE FUNCTION public.guard_publish_requires_questions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  approved_count bigint;
  curr_id uuid;
BEGIN
  -- Only fire when status changes TO 'published'
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    -- Resolve curriculum_id
    curr_id := NEW.curriculum_id;
    IF curr_id IS NULL THEN
      SELECT c.curriculum_id INTO curr_id
      FROM courses c WHERE c.id = NEW.course_id;
    END IF;

    IF curr_id IS NOT NULL THEN
      SELECT count(*) INTO approved_count
      FROM exam_questions eq
      WHERE eq.curriculum_id = curr_id AND eq.status = 'approved';
    ELSE
      approved_count := 0;
    END IF;

    IF approved_count < 100 THEN
      -- Block the publish and set to quality_gate_failed instead
      NEW.status := 'quality_gate_failed';
      NEW.blocked_reason := format('PUBLISH_BLOCKED: only %s approved questions (min 100 required)', approved_count);
      NEW.updated_at := now();
      
      -- Send admin notification
      INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id)
      VALUES (
        format('Publish blocked: %s', NEW.title),
        format('Package has only %s approved questions. Minimum 100 required for publishing.', approved_count),
        'pipeline',
        'error',
        'course_package',
        NEW.id
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Attach trigger
DROP TRIGGER IF EXISTS trg_guard_publish_requires_questions ON course_packages;
CREATE TRIGGER trg_guard_publish_requires_questions
  BEFORE UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION guard_publish_requires_questions();
