
-- ============================================================
-- 1. Add trap_type column to minicheck_questions
-- ============================================================
ALTER TABLE public.minicheck_questions
ADD COLUMN IF NOT EXISTS trap_type text;

COMMENT ON COLUMN public.minicheck_questions.trap_type IS 
'Categorized trap type: misconception, typical_error, calculation_trap — derived from trap_tags';

CREATE INDEX IF NOT EXISTS idx_minicheck_questions_trap_type 
ON public.minicheck_questions (trap_type) WHERE trap_type IS NOT NULL;

-- ============================================================
-- 2. Backfill trap_type from trap_tags
-- ============================================================
UPDATE public.minicheck_questions
SET trap_type = CASE
  WHEN 'misconception' = ANY(trap_tags) THEN 'misconception'
  WHEN 'typical_error' = ANY(trap_tags) THEN 'typical_error'
  WHEN 'calculation_trap' = ANY(trap_tags) THEN 'calculation_trap'
  WHEN 'Missverständnis' = ANY(trap_tags) THEN 'misconception'
  WHEN 'Typischer Fehler' = ANY(trap_tags) THEN 'typical_error'
  WHEN 'Rechenfalle' = ANY(trap_tags) THEN 'calculation_trap'
  WHEN array_length(trap_tags, 1) > 0 THEN 'typical_error'
  ELSE NULL
END
WHERE trap_type IS NULL AND trap_tags != '{}';

-- ============================================================
-- 3. Quality gate function for MiniCheck approval
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_minicheck_qualifies_for_approval(
  p_question_text text,
  p_options jsonb,
  p_correct_answer int,
  p_explanation text,
  p_competency_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  -- MiniCheck-specific gates (lighter than exam!)
  IF p_question_text IS NULL OR length(p_question_text) < 30 THEN RETURN false; END IF;
  IF p_options IS NULL OR jsonb_array_length(p_options) != 4 THEN RETURN false; END IF;
  IF p_correct_answer IS NULL OR p_correct_answer < 0 OR p_correct_answer > 3 THEN RETURN false; END IF;
  IF p_explanation IS NULL OR length(p_explanation) < 40 THEN RETURN false; END IF;
  IF p_competency_id IS NULL THEN RETURN false; END IF;
  
  RETURN true;
END;
$$;

-- ============================================================
-- 4. Auto-promote trigger for MiniChecks
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_fn_auto_promote_minicheck()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only process drafts
  IF NEW.status != 'draft' THEN
    RETURN NEW;
  END IF;
  
  -- Check quality gates
  IF fn_minicheck_qualifies_for_approval(
    NEW.question_text,
    NEW.options,
    NEW.correct_answer,
    NEW.explanation,
    NEW.competency_id
  ) THEN
    NEW.status := 'approved';
    NEW.updated_at := now();
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop if exists to avoid duplicate
DROP TRIGGER IF EXISTS trg_auto_promote_minicheck ON public.minicheck_questions;

CREATE TRIGGER trg_auto_promote_minicheck
BEFORE INSERT OR UPDATE OF question_text, options, correct_answer, explanation, competency_id, status
ON public.minicheck_questions
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_auto_promote_minicheck();

-- ============================================================
-- 5. Bulk backfill: promote all qualifying drafts to approved
-- ============================================================
UPDATE public.minicheck_questions
SET status = 'approved', updated_at = now()
WHERE status = 'draft'
  AND fn_minicheck_qualifies_for_approval(
    question_text, options, correct_answer, explanation, competency_id
  );

-- ============================================================
-- 6. Publish gate function per curriculum
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_minicheck_publish_gate(p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_approved int;
  v_total_competencies int;
  v_covered_competencies int;
  v_coverage numeric;
  v_result jsonb;
BEGIN
  -- Count approved MiniChecks
  SELECT count(*) INTO v_total_approved
  FROM minicheck_questions
  WHERE curriculum_id = p_curriculum_id AND status = 'approved';
  
  -- Count total competencies for this curriculum
  SELECT count(DISTINCT c.id) INTO v_total_competencies
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = p_curriculum_id;
  
  -- Count competencies with at least 1 approved minicheck
  SELECT count(DISTINCT competency_id) INTO v_covered_competencies
  FROM minicheck_questions
  WHERE curriculum_id = p_curriculum_id 
    AND status = 'approved'
    AND competency_id IS NOT NULL;
  
  v_coverage := CASE WHEN v_total_competencies > 0 
    THEN round(100.0 * v_covered_competencies / v_total_competencies, 1)
    ELSE 0 END;
  
  RETURN jsonb_build_object(
    'passed', v_coverage >= 80,
    'total_approved', v_total_approved,
    'total_competencies', v_total_competencies,
    'covered_competencies', v_covered_competencies,
    'coverage_pct', v_coverage,
    'gate_threshold', 80
  );
END;
$$;

-- ============================================================
-- 7. Monitoring view for MiniCheck QC status per curriculum
-- ============================================================
CREATE OR REPLACE VIEW public.v_minicheck_qc_overview AS
SELECT 
  mq.curriculum_id,
  c.title as curriculum_title,
  count(*) as total_questions,
  count(*) FILTER (WHERE mq.status = 'approved') as approved,
  count(*) FILTER (WHERE mq.status = 'draft') as still_draft,
  count(*) FILTER (WHERE mq.trap_type IS NOT NULL) as with_trap,
  round(100.0 * count(*) FILTER (WHERE mq.status = 'approved') / NULLIF(count(*), 0), 1) as approval_rate,
  round(100.0 * count(*) FILTER (WHERE mq.trap_type IS NOT NULL) / NULLIF(count(*), 0), 1) as trap_coverage,
  count(DISTINCT mq.competency_id) as competencies_covered,
  (SELECT fn_minicheck_publish_gate(mq.curriculum_id)) as publish_gate
FROM minicheck_questions mq
LEFT JOIN curricula c ON c.id = mq.curriculum_id
GROUP BY mq.curriculum_id, c.title;

NOTIFY pgrst, 'reload schema';
