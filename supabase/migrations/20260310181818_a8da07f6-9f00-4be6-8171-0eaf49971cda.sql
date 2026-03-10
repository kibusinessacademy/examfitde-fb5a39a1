
-- Fix: Reconcile integrity_passed for packages where the integrity_report confirms passing
-- Root cause: Silent write failure in integrity-check edge function left integrity_passed=false
-- despite integrity_report showing score=100 and no hard_fail_reasons
UPDATE course_packages 
SET integrity_passed = true
WHERE integrity_passed = false
  AND integrity_report IS NOT NULL
  AND integrity_report->>'score' IS NOT NULL
  AND (integrity_report->>'score')::int >= 85
  AND (
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        COALESCE(integrity_report->'v3'->'hard_fail_reasons', '[]'::jsonb)
      ) AS hf
    )
  );

-- Create a trigger to auto-reconcile integrity_passed from integrity_report
-- This prevents the race condition from blocking auto_publish again
CREATE OR REPLACE FUNCTION reconcile_integrity_passed()
RETURNS TRIGGER AS $$
BEGIN
  -- If integrity_report is set and shows no hard fails, ensure integrity_passed=true
  IF NEW.integrity_report IS NOT NULL 
     AND NEW.integrity_report->>'score' IS NOT NULL
     AND (NEW.integrity_report->>'score')::int >= 85
     AND (
       NEW.integrity_report->'v3'->'hard_fail_reasons' IS NULL
       OR jsonb_array_length(COALESCE(NEW.integrity_report->'v3'->'hard_fail_reasons', '[]'::jsonb)) = 0
     )
  THEN
    NEW.integrity_passed := true;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reconcile_integrity_passed ON course_packages;
CREATE TRIGGER trg_reconcile_integrity_passed
  BEFORE UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION reconcile_integrity_passed();
