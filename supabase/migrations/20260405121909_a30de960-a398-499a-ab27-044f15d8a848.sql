
-- 1. Central eligibility function
CREATE OR REPLACE FUNCTION public.fn_exam_question_tier1_eligibility(
  p_blueprint_id uuid, p_competency_id uuid, p_curriculum_id uuid,
  p_learning_field_id uuid, p_cognitive_level text, p_exam_part text,
  p_question_text text, p_explanation text, p_correct_answer int, p_options jsonb
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  reasons text[] := '{}';
  option_count int;
BEGIN
  IF p_blueprint_id IS NULL THEN reasons := array_append(reasons, 'missing_blueprint_id'); END IF;
  IF p_competency_id IS NULL THEN reasons := array_append(reasons, 'missing_competency_id'); END IF;
  IF p_curriculum_id IS NULL THEN reasons := array_append(reasons, 'missing_curriculum_id'); END IF;
  IF p_learning_field_id IS NULL THEN reasons := array_append(reasons, 'missing_learning_field_id'); END IF;
  IF p_cognitive_level IS NULL OR p_cognitive_level = '' THEN reasons := array_append(reasons, 'missing_cognitive_level'); END IF;
  IF p_exam_part IS NULL OR p_exam_part = '' THEN reasons := array_append(reasons, 'missing_exam_part'); END IF;
  IF p_question_text IS NULL OR length(p_question_text) < 60 THEN reasons := array_append(reasons, 'question_text_too_short'); END IF;
  IF p_explanation IS NULL OR length(p_explanation) < 20 THEN reasons := array_append(reasons, 'explanation_too_short'); END IF;
  option_count := COALESCE(jsonb_array_length(p_options), 0);
  IF option_count < 2 THEN reasons := array_append(reasons, 'insufficient_options'); END IF;
  IF p_correct_answer IS NULL OR p_correct_answer < 0 OR p_correct_answer >= option_count THEN
    reasons := array_append(reasons, 'invalid_correct_answer');
  END IF;
  RETURN jsonb_build_object(
    'eligible', array_length(reasons, 1) IS NULL,
    'reasons', to_jsonb(reasons),
    'reason_count', COALESCE(array_length(reasons, 1), 0)
  );
END;
$$;

-- 2. Derive exam_part from blueprint (enum cast to text)
CREATE OR REPLACE FUNCTION public.fn_derive_exam_part(p_blueprint_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN lower(qb.exam_context_type::text) LIKE '%teil_2%' OR lower(qb.exam_context_type::text) LIKE '%part_2%' OR lower(qb.exam_context_type::text) LIKE '%mündlich%' THEN 'teil_2'
    WHEN lower(qb.exam_context_type::text) LIKE '%teil_1%' OR lower(qb.exam_context_type::text) LIKE '%part_1%' OR lower(qb.exam_context_type::text) LIKE '%schriftlich%' THEN 'teil_1'
    ELSE NULL
  END FROM question_blueprints qb WHERE qb.id = p_blueprint_id LIMIT 1;
$$;

-- 3. Drop old triggers
DROP TRIGGER IF EXISTS trg_backfill_promotion_fields ON public.exam_questions;
DROP TRIGGER IF EXISTS aaa_backfill_promotion_fields ON public.exam_questions;

-- 4. Trigger function (difficulty is enum, no '' comparison)
CREATE OR REPLACE FUNCTION public.fn_exam_question_backfill_and_qc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  eligibility jsonb;
  derived_exam_part text;
BEGIN
  IF NEW.exam_part IS NULL OR NEW.exam_part = '' THEN
    derived_exam_part := public.fn_derive_exam_part(NEW.blueprint_id);
    IF derived_exam_part IS NOT NULL THEN
      NEW.exam_part := derived_exam_part;
    END IF;
  END IF;

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

-- 5. Trigger on INSERT + UPDATE
CREATE TRIGGER aaa_backfill_promotion_fields
  BEFORE INSERT OR UPDATE ON public.exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_exam_question_backfill_and_qc();

-- 6. Backfill teil_1-defaulted questions
WITH derived AS (
  SELECT eq.id, public.fn_derive_exam_part(eq.blueprint_id) AS real_exam_part
  FROM exam_questions eq
  WHERE eq.exam_part = 'teil_1' AND eq.blueprint_id IS NOT NULL
)
UPDATE exam_questions eq
SET
  exam_part = CASE WHEN d.real_exam_part IS NOT NULL THEN d.real_exam_part ELSE eq.exam_part END,
  qc_status = CASE WHEN d.real_exam_part IS NULL THEN 'needs_review' ELSE eq.qc_status END,
  meta = CASE
    WHEN d.real_exam_part IS NULL
    THEN COALESCE(eq.meta, '{}'::jsonb) || '{"promotion_block_reasons": ["missing_exam_part_derivation"]}'::jsonb
    ELSE eq.meta
  END
FROM derived d
WHERE eq.id = d.id AND d.real_exam_part IS DISTINCT FROM 'teil_1';
