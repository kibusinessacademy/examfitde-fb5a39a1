
-- Dauermaßnahme: Automatische QC-Status-Synchronisation
-- Verhindert den systemweiten status vs qc_status Drift

CREATE OR REPLACE FUNCTION fn_sync_qc_status_on_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Wenn status auf approved gesetzt wird, qc_status synchronisieren
  IF NEW.status = 'approved' 
     AND (OLD.status IS DISTINCT FROM 'approved')
     AND NEW.qc_status NOT IN ('approved', 'archived', 'rejected') THEN
    NEW.qc_status := 'approved';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger VOR dem bestehenden Quality Guard, damit qc_status korrekt ist
DROP TRIGGER IF EXISTS trg_sync_qc_status_on_approval ON exam_questions;
CREATE TRIGGER trg_sync_qc_status_on_approval
  BEFORE UPDATE ON exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_qc_status_on_approval();
