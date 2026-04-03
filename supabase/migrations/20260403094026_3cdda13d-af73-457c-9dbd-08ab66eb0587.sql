
-- 1. Fix fn_minicheck_qualifies_for_approval to REQUIRE traps
CREATE OR REPLACE FUNCTION public.fn_minicheck_qualifies_for_approval(
  p_question_text text,
  p_options jsonb,
  p_correct_answer int,
  p_explanation text,
  p_competency_id uuid,
  p_trap_tags text[] DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF p_question_text IS NULL OR length(p_question_text) < 30 THEN RETURN false; END IF;
  IF p_options IS NULL OR jsonb_array_length(p_options) != 4 THEN RETURN false; END IF;
  IF p_correct_answer IS NULL OR p_correct_answer < 0 OR p_correct_answer > 3 THEN RETURN false; END IF;
  IF p_explanation IS NULL OR length(p_explanation) < 40 THEN RETURN false; END IF;
  IF p_competency_id IS NULL THEN RETURN false; END IF;
  -- V2: Trap tags mandatory
  IF p_trap_tags IS NULL OR cardinality(p_trap_tags) = 0 THEN RETURN false; END IF;
  RETURN true;
END;
$$;

-- 2. Recreate trigger to pass trap_tags and add anti-ping-pong + audit
CREATE OR REPLACE FUNCTION public.fn_auto_promote_minicheck()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only promote drafts, never re-approve rejected/needs_review
  IF NEW.status != 'draft' THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND OLD.status IN ('rejected', 'needs_review') THEN RETURN NEW; END IF;

  IF fn_minicheck_qualifies_for_approval(
    NEW.question_text,
    NEW.options,
    NEW.correct_answer,
    NEW.explanation,
    NEW.competency_id,
    NEW.trap_tags
  ) THEN
    NEW.status := 'approved';
    NEW.approved_by := 'auto_qc_minicheck_v2';
    NEW.approved_at := now();
    NEW.approval_reason := 'auto_gate_passed_v2';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_promote_minicheck ON public.minicheck_questions;
CREATE TRIGGER trg_auto_promote_minicheck
  BEFORE INSERT OR UPDATE OF question_text, options, correct_answer, explanation, competency_id, trap_tags, status
  ON public.minicheck_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_promote_minicheck();

-- 3. Demote approved without traps back to draft
UPDATE public.minicheck_questions
SET status = 'draft',
    approved_by = NULL,
    approved_at = NULL,
    approval_reason = NULL
WHERE status = 'approved'
  AND (trap_tags IS NULL OR cardinality(trap_tags) = 0);

-- 4. Backfill any remaining approved without audit
UPDATE public.minicheck_questions
SET approved_by = 'auto_qc_minicheck_v2_backfill',
    approved_at = COALESCE(approved_at, updated_at, now()),
    approval_reason = 'audit_reconciliation_v2'
WHERE status = 'approved'
  AND approved_by IS NULL;

NOTIFY pgrst, 'reload schema';
