
-- ─────────────────────────────────────────────────────────────────────────────
-- Preflight: Fail fast if any approved rows have LF mismatch
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_mismatch int;
BEGIN
  SELECT COUNT(*) INTO v_mismatch
  FROM public.exam_questions q
  JOIN public.competencies c ON c.id = q.competency_id
  WHERE q.status = 'approved'
    AND q.learning_field_id IS DISTINCT FROM c.learning_field_id;

  IF v_mismatch <> 0 THEN
    RAISE EXCEPTION 'Cannot deploy LF consistency trigger: % approved exam_questions have learning_field_id mismatch vs competencies', v_mismatch;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Function: enforce + auto-derive learning_field_id from competency_id
-- + immutability once OLD.status='approved'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_exam_questions_enforce_learning_field_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_lf uuid;
BEGIN
  -- 1) Immutable after approved (write-once, then immutable)
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    IF NEW.competency_id IS DISTINCT FROM OLD.competency_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SSOT_GUARD_IMMUTABLE: competency_id cannot be changed after status=approved';
    END IF;

    IF NEW.learning_field_id IS DISTINCT FROM OLD.learning_field_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SSOT_GUARD_IMMUTABLE: learning_field_id cannot be changed after status=approved';
    END IF;
  END IF;

  -- 2) If competency_id is null, we cannot derive LF.
  --    (Approved-Guards already prevent approved with null competency_id.)
  IF NEW.competency_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 3) Derive LF from competencies (SSOT)
  SELECT c.learning_field_id
    INTO v_lf
  FROM public.competencies c
  WHERE c.id = NEW.competency_id;

  IF v_lf IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'SSOT_GUARD: competency_id must reference competencies with non-null learning_field_id';
  END IF;

  -- 4) Always enforce the derived value (server-side truth)
  NEW.learning_field_id := v_lf;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: idempotent recreate
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS exam_questions_enforce_learning_field_id ON public.exam_questions;

CREATE TRIGGER exam_questions_enforce_learning_field_id
BEFORE INSERT OR UPDATE OF competency_id, learning_field_id, status
ON public.exam_questions
FOR EACH ROW
EXECUTE FUNCTION public.trg_exam_questions_enforce_learning_field_id();
