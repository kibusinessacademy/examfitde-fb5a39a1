
-- Fix guard_sealed_course trigger to properly handle DELETE operations
CREATE OR REPLACE FUNCTION guard_sealed_course()
RETURNS TRIGGER AS $$
DECLARE
  v_course_status text;
  v_autopilot_status text;
BEGIN
  -- For lessons, check via module → course
  IF TG_TABLE_NAME = 'lessons' THEN
    SELECT c.status, c.autopilot_status 
    INTO v_course_status, v_autopilot_status
    FROM courses c
    JOIN modules m ON m.course_id = c.id
    WHERE m.id = COALESCE(NEW.module_id, OLD.module_id);
  -- For modules, check via course directly
  ELSIF TG_TABLE_NAME = 'modules' THEN
    SELECT c.status, c.autopilot_status
    INTO v_course_status, v_autopilot_status
    FROM courses c
    WHERE c.id = COALESCE(NEW.course_id, OLD.course_id);
  END IF;

  IF v_autopilot_status = 'sealed' THEN
    RAISE EXCEPTION 'SEALED_COURSE: Kurs ist versiegelt. Keine Änderungen erlaubt. Bitte erstellen Sie eine neue Version.';
  END IF;

  -- Return OLD for DELETE, NEW for INSERT/UPDATE
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
