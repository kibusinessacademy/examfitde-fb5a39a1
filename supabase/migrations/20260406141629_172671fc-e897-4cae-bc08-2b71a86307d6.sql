
CREATE OR REPLACE FUNCTION fn_exam_question_backfill_and_qc()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  eligibility jsonb;
  derived_exam_part text;
BEGIN
  -- Backfill exam_part if missing
  IF NEW.exam_part IS NULL OR NEW.exam_part = '' THEN
    derived_exam_part := public.fn_derive_exam_part(NEW.blueprint_id);
    IF derived_exam_part IS NOT NULL THEN
      NEW.exam_part := derived_exam_part;
    END IF;
  END IF;

  -- Backfill difficulty if missing
  IF NEW.difficulty IS NULL THEN
    NEW.difficulty := CASE NEW.cognitive_level
      WHEN 'remember' THEN 'easy'::question_difficulty
      WHEN 'understand' THEN 'easy'::question_difficulty
      WHEN 'apply' THEN 'medium'::question_difficulty
      WHEN 'analyze' THEN 'hard'::question_difficulty
      WHEN 'evaluate' THEN 'hard'::question_difficulty
      WHEN 'create' THEN 'hard'::question_difficulty
      ELSE 'medium'::question_difficulty
    END;
  END IF;

  -- ═══ FIX: Do NOT recalculate qc_status when it is explicitly set to 'approved' ═══
  -- The repair RPC and admin actions intentionally set qc_status='approved'.
  -- Previously this trigger unconditionally overwrote it back to 'tier1_passed',
  -- causing an infinite repair loop (REPAIR_DOMAIN_SUCCESS_NO_GATE_DELTA).
  IF NEW.qc_status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Also skip recalculation for terminal states that should not be overwritten
  IF NEW.qc_status IN ('rejected', 'archived') THEN
    RETURN NEW;
  END IF;

  eligibility := public.fn_exam_question_tier1_eligibility(
    NEW.blueprint_id, NEW.competency_id, NEW.curriculum_id,
    NEW.learning_field_id, NEW.cognitive_level, NEW.exam_part,
    NEW.question_text, NEW.explanation, NEW.correct_answer,
    to_jsonb(NEW.options)
  );

  IF (eligibility->>'eligible')::boolean THEN
    NEW.qc_status := 'tier1_passed';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) - 'promotion_block_reason' - 'promotion_block_reasons';
  ELSE
    NEW.qc_status := 'needs_review';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb)
      || jsonb_build_object('promotion_block_reasons', eligibility->'reasons');
  END IF;

  RETURN NEW;
END;
$$;
