
-- Guard: block approval transition without trap_type
CREATE OR REPLACE FUNCTION public.fn_guard_approval_requires_trap_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only enforce on transition TO approved
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    IF NEW.trap_type IS NULL THEN
      RAISE EXCEPTION 'APPROVAL_REQUIRES_TRAP_TYPE: Cannot approve question % without trap_type', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_approval_trap_type ON exam_questions;

CREATE TRIGGER trg_guard_approval_trap_type
BEFORE UPDATE ON exam_questions
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_approval_requires_trap_type();

-- Also guard INSERT with status=approved directly
DROP TRIGGER IF EXISTS trg_guard_approval_trap_type_insert ON exam_questions;

CREATE TRIGGER trg_guard_approval_trap_type_insert
BEFORE INSERT ON exam_questions
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_approval_requires_trap_type();
