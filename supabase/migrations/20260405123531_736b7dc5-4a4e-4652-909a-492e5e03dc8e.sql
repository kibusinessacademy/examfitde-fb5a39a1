-- 1. CHECK constraint for qc_status canonical values
ALTER TABLE public.exam_questions
  ADD CONSTRAINT chk_exam_questions_qc_status
  CHECK (qc_status IS NULL OR qc_status IN (
    'draft', 'pending', 'tier1_passed', 'tier1_failed',
    'needs_review', 'needs_revision', 'approved', 'rejected'
  ));

-- 2. Fix fn_derive_exam_part to map real exam_context_type values
CREATE OR REPLACE FUNCTION public.fn_derive_exam_part(p_blueprint_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- Pattern matching (legacy/future)
    WHEN lower(qb.exam_context_type::text) LIKE '%teil_2%' OR lower(qb.exam_context_type::text) LIKE '%part_2%' OR lower(qb.exam_context_type::text) LIKE '%mündlich%' THEN 'teil_2'
    WHEN lower(qb.exam_context_type::text) LIKE '%teil_1%' OR lower(qb.exam_context_type::text) LIKE '%part_1%' OR lower(qb.exam_context_type::text) LIKE '%schriftlich%' THEN 'teil_1'
    -- Deterministic mapping for actual enum values
    WHEN qb.exam_context_type IN ('isolated_knowledge', 'calculation_analysis', 'error_detection', 'legal_evaluation') THEN 'teil_1'
    WHEN qb.exam_context_type IN ('case_study', 'strategic_decision', 'multi_step_case') THEN 'teil_2'
    WHEN qb.exam_context_type IN ('applied_case', 'prioritization', 'model_comparison') THEN 'teil_1'
    ELSE NULL
  END FROM question_blueprints qb WHERE qb.id = p_blueprint_id LIMIT 1;
$$;

-- 3. Update fn_exam_question_backfill_and_qc to re-derive when exam_part was set by fallback
-- (no change needed — trigger already re-evaluates via fn_derive_exam_part on NULL/empty)

-- 4. Re-evaluate questions that got silent teil_1 default but may now derive correctly
-- This triggers fn_exam_question_backfill_and_qc via UPDATE trigger
UPDATE public.exam_questions
SET exam_part = NULL
WHERE exam_part = 'teil_1'
  AND blueprint_id IS NOT NULL
  AND (meta->>'generator_version') LIKE '2026-04-05%';