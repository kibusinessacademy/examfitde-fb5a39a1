
-- Permanent auto-promotion: draft+tier1_passed → approved
-- Only when all governance fields are present (matching the guard constraints)

CREATE OR REPLACE FUNCTION fn_auto_promote_tier1_passed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act on draft questions that just became tier1_passed
  IF NEW.status = 'draft' AND NEW.qc_status = 'tier1_passed' THEN
    -- Check all mandatory governance fields are present
    IF  NEW.curriculum_id IS NOT NULL
        AND NEW.learning_field_id IS NOT NULL
        AND NEW.competency_id IS NOT NULL
        AND NEW.difficulty IS NOT NULL
        AND NEW.cognitive_level IS NOT NULL
        AND NEW.correct_answer IS NOT NULL
        AND NEW.question_text IS NOT NULL
        AND length(NEW.question_text) >= 10
    THEN
      -- Auto-promote to approved
      NEW.status := 'approved';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Fire BEFORE INSERT/UPDATE so we can modify the row in-flight
-- Priority: run before the governance guards (which validate approved fields)
DROP TRIGGER IF EXISTS trg_auto_promote_tier1_to_approved ON exam_questions;

CREATE TRIGGER trg_auto_promote_tier1_to_approved
  BEFORE INSERT OR UPDATE ON exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_promote_tier1_passed();
