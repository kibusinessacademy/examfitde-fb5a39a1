-- Auto-promote exam question status when qc_status becomes 'approved'
CREATE OR REPLACE FUNCTION public.exam_questions_promote_on_qc()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.qc_status = 'approved' AND NEW.status = 'draft' THEN
    NEW.status := 'approved';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exam_questions_promote_on_qc ON public.exam_questions;

CREATE TRIGGER trg_exam_questions_promote_on_qc
BEFORE INSERT OR UPDATE OF qc_status, status
ON public.exam_questions
FOR EACH ROW
EXECUTE FUNCTION public.exam_questions_promote_on_qc();