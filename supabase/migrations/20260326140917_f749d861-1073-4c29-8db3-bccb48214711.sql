
-- ============================================================
-- PRODUCTION-GRADE AUTO-PROMOTION WITH QUALITY GUARDS
-- Replaces the naive trg_auto_promote_tier1_to_approved
-- ============================================================

-- 1. Drop the naive trigger
DROP TRIGGER IF EXISTS trg_auto_promote_tier1_to_approved ON exam_questions;
DROP FUNCTION IF EXISTS fn_auto_promote_tier1_passed();

-- 2. Create the hardened auto-promotion function
--    3-stage: draft → approved (only with quality signals)
CREATE OR REPLACE FUNCTION fn_auto_promote_tier1_guarded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _option_count int;
BEGIN
  -- Only act on draft questions with tier1_passed
  IF NEW.status <> 'draft' OR NEW.qc_status <> 'tier1_passed' THEN
    RETURN NEW;
  END IF;

  -- ── STAGE 1: Structural completeness (mandatory fields) ──
  IF  NEW.curriculum_id IS NULL
      OR NEW.learning_field_id IS NULL
      OR NEW.competency_id IS NULL
      OR NEW.difficulty IS NULL
      OR NEW.cognitive_level IS NULL
      OR NEW.correct_answer IS NULL
      OR NEW.question_text IS NULL
      OR length(NEW.question_text) < 10
  THEN
    -- Stay as draft, structural requirements not met
    RETURN NEW;
  END IF;

  -- ── STAGE 2: Quality gates ──
  -- 2a. Minimum question length (not trivial one-liner)
  IF length(NEW.question_text) < 60 THEN
    RETURN NEW;
  END IF;

  -- 2b. Minimum 4 answer options for MC questions
  _option_count := jsonb_array_length(COALESCE(NEW.options, '[]'::jsonb));
  IF NEW.question_type IN ('multiple_choice', 'mc') AND _option_count < 4 THEN
    RETURN NEW;
  END IF;

  -- 2c. Explanation must exist and be meaningful
  IF NEW.explanation IS NULL OR length(NEW.explanation) < 20 THEN
    RETURN NEW;
  END IF;

  -- 2d. Exam part must be set (IHK structure)
  IF NEW.exam_part IS NULL THEN
    RETURN NEW;
  END IF;

  -- ── STAGE 3: Promote ──
  NEW.status := 'approved';
  
  RETURN NEW;
END;
$$;

-- 3. Create the guarded trigger (BEFORE so we can mutate the row)
CREATE TRIGGER trg_auto_promote_tier1_guarded
  BEFORE INSERT OR UPDATE ON exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_promote_tier1_guarded();

-- ============================================================
-- POST-APPROVAL GUARD: Prevents silent quality corruption
-- Fires AFTER the promotion trigger, catches any approved row
-- (including manual approvals) that violates quality minimums
-- ============================================================

CREATE OR REPLACE FUNCTION fn_guard_approved_quality()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _option_count int;
BEGIN
  -- Only guard transitions INTO approved status
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;
  
  -- Skip if already approved (no re-validation on unrelated updates)
  IF OLD IS NOT NULL AND OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Gate 1: Question text minimum quality
  IF length(NEW.question_text) < 40 THEN
    RAISE EXCEPTION 'QUALITY_GUARD: approved question_text too short (% chars, min 40)', length(NEW.question_text);
  END IF;

  -- Gate 2: Explanation required and meaningful
  IF NEW.explanation IS NULL OR length(NEW.explanation) < 15 THEN
    RAISE EXCEPTION 'QUALITY_GUARD: approved question missing meaningful explanation';
  END IF;

  -- Gate 3: MC questions need >= 4 options
  _option_count := jsonb_array_length(COALESCE(NEW.options, '[]'::jsonb));
  IF NEW.question_type IN ('multiple_choice', 'mc') AND _option_count < 4 THEN
    RAISE EXCEPTION 'QUALITY_GUARD: approved MC question has only % options (min 4)', _option_count;
  END IF;

  -- Gate 4: Taxonomy fields present
  IF NEW.difficulty IS NULL OR NEW.cognitive_level IS NULL THEN
    RAISE EXCEPTION 'QUALITY_GUARD: approved question missing difficulty or cognitive_level';
  END IF;

  -- Gate 5: Curriculum linkage complete
  IF NEW.competency_id IS NULL OR NEW.learning_field_id IS NULL THEN
    RAISE EXCEPTION 'QUALITY_GUARD: approved question missing competency_id or learning_field_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_approved_quality ON exam_questions;

CREATE TRIGGER trg_guard_approved_quality
  BEFORE INSERT OR UPDATE ON exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_approved_quality();
