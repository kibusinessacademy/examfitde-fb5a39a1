
-- ═══════════════════════════════════════════════════════
-- TRIGGER: Auto-backfill promotion-critical fields on INSERT
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_backfill_promotion_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Backfill exam_part if missing
  IF NEW.exam_part IS NULL THEN
    NEW.exam_part := 'teil_1';
  END IF;

  -- Backfill difficulty from cognitive_level if missing
  IF NEW.difficulty IS NULL AND NEW.cognitive_level IS NOT NULL THEN
    NEW.difficulty := CASE NEW.cognitive_level
      WHEN 'remember' THEN 'easy'
      WHEN 'understand' THEN 'easy'
      WHEN 'apply' THEN 'medium'
      WHEN 'analyze' THEN 'hard'
      WHEN 'evaluate' THEN 'hard'
      WHEN 'create' THEN 'hard'
      ELSE 'medium'
    END;
  END IF;

  -- Set qc_status if still NULL (don't overwrite explicit values)
  IF NEW.qc_status IS NULL THEN
    IF NEW.blueprint_id IS NOT NULL
       AND NEW.competency_id IS NOT NULL
       AND NEW.curriculum_id IS NOT NULL
       AND NEW.learning_field_id IS NOT NULL
       AND NEW.cognitive_level IS NOT NULL
       AND NEW.correct_answer IS NOT NULL
       AND NEW.question_text IS NOT NULL
       AND length(NEW.question_text) >= 60
       AND NEW.explanation IS NOT NULL
       AND length(NEW.explanation) >= 20
       AND NEW.exam_part IS NOT NULL
    THEN
      NEW.qc_status := 'tier1_passed';
    ELSE
      NEW.qc_status := 'needs_review';
      -- Record reason in meta
      NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
        'promotion_block_reason',
        CASE
          WHEN NEW.blueprint_id IS NULL THEN 'missing_blueprint_id'
          WHEN NEW.competency_id IS NULL THEN 'missing_competency_id'
          WHEN NEW.curriculum_id IS NULL THEN 'missing_curriculum_id'
          WHEN NEW.learning_field_id IS NULL THEN 'missing_learning_field_id'
          WHEN NEW.cognitive_level IS NULL THEN 'missing_cognitive_level'
          WHEN NEW.question_text IS NULL OR length(NEW.question_text) < 60 THEN 'question_text_too_short'
          WHEN NEW.explanation IS NULL OR length(NEW.explanation) < 20 THEN 'explanation_too_short'
          ELSE 'unknown_deficiency'
        END
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Fire BEFORE auto-promote trigger (default alphabetical: "b" < "t")
CREATE TRIGGER trg_backfill_promotion_fields
  BEFORE INSERT ON exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION fn_backfill_promotion_fields();

-- ═══════════════════════════════════════════════════════
-- BACKFILL: Heal existing draft questions
-- ═══════════════════════════════════════════════════════

-- 1) Backfill exam_part where missing
UPDATE exam_questions
SET exam_part = 'teil_1'
WHERE exam_part IS NULL AND status = 'draft';

-- 2) Backfill difficulty where missing
UPDATE exam_questions
SET difficulty = CASE cognitive_level
  WHEN 'remember' THEN 'easy'
  WHEN 'understand' THEN 'easy'
  WHEN 'apply' THEN 'medium'
  WHEN 'analyze' THEN 'hard'
  WHEN 'evaluate' THEN 'hard'
  WHEN 'create' THEN 'hard'
  ELSE 'medium'
END::question_difficulty
WHERE difficulty IS NULL AND status = 'draft' AND cognitive_level IS NOT NULL;

-- 3) Set qc_status = tier1_passed for structurally complete drafts
UPDATE exam_questions
SET qc_status = 'tier1_passed'
WHERE status = 'draft'
  AND qc_status IS NULL
  AND blueprint_id IS NOT NULL
  AND competency_id IS NOT NULL
  AND curriculum_id IS NOT NULL
  AND learning_field_id IS NOT NULL
  AND cognitive_level IS NOT NULL
  AND correct_answer IS NOT NULL
  AND question_text IS NOT NULL
  AND length(question_text) >= 60
  AND explanation IS NOT NULL
  AND length(explanation) >= 20
  AND exam_part IS NOT NULL;

-- 4) Mark structurally incomplete drafts as needs_review
UPDATE exam_questions
SET qc_status = 'needs_review',
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'promotion_block_reason',
      CASE
        WHEN competency_id IS NULL THEN 'missing_competency_id'
        WHEN learning_field_id IS NULL THEN 'missing_learning_field_id'
        WHEN cognitive_level IS NULL THEN 'missing_cognitive_level'
        WHEN question_text IS NULL OR length(question_text) < 60 THEN 'question_text_too_short'
        WHEN explanation IS NULL OR length(explanation) < 20 THEN 'explanation_too_short'
        ELSE 'unknown_deficiency'
      END,
      'backfill_healed_at', to_jsonb(now())
    )
WHERE status = 'draft'
  AND qc_status IS NULL
  AND (
    competency_id IS NULL
    OR learning_field_id IS NULL
    OR cognitive_level IS NULL
    OR question_text IS NULL
    OR length(question_text) < 60
    OR explanation IS NULL
    OR length(explanation) < 20
  );
