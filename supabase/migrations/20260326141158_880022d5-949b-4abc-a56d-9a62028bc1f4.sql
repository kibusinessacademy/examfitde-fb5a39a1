
-- ============================================================
-- P1 HARDENING: Telemetry, Reason Codes, Observability, Optimization
-- ============================================================

-- 1. Audit table for promotion events & rejections
CREATE TABLE IF NOT EXISTS public.exam_promotion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  previous_status text NOT NULL,
  new_status text NOT NULL,
  reason_code text,  -- NULL = promoted, otherwise rejection reason
  trigger_version text NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_epa_curriculum ON exam_promotion_audit(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_epa_reason ON exam_promotion_audit(reason_code) WHERE reason_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_epa_created ON exam_promotion_audit(created_at DESC);

ALTER TABLE public.exam_promotion_audit ENABLE ROW LEVEL SECURITY;

-- 2. Replace auto-promote trigger with telemetry + reason codes
CREATE OR REPLACE FUNCTION fn_auto_promote_tier1_guarded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _option_count int;
  _reason text := NULL;
BEGIN
  -- Only act on draft questions with tier1_passed
  IF NEW.status <> 'draft' OR NEW.qc_status <> 'tier1_passed' THEN
    RETURN NEW;
  END IF;

  -- ── STAGE 1: Structural completeness ──
  IF NEW.curriculum_id IS NULL OR NEW.learning_field_id IS NULL
     OR NEW.competency_id IS NULL OR NEW.difficulty IS NULL
     OR NEW.cognitive_level IS NULL OR NEW.correct_answer IS NULL
     OR NEW.question_text IS NULL OR length(NEW.question_text) < 10
  THEN
    _reason := 'missing_mandatory_fields';
    INSERT INTO exam_promotion_audit(question_id, curriculum_id, previous_status, new_status, reason_code)
    VALUES (NEW.id, NEW.curriculum_id, NEW.status, NEW.status, _reason);
    RETURN NEW;
  END IF;

  -- ── STAGE 2: Quality gates ──
  IF length(NEW.question_text) < 60 THEN
    _reason := 'question_too_short';
  END IF;

  IF _reason IS NULL THEN
    _option_count := jsonb_array_length(COALESCE(NEW.options, '[]'::jsonb));
    IF NEW.question_type IN ('multiple_choice', 'mc') AND _option_count < 4 THEN
      _reason := 'mc_too_few_options';
    END IF;
  END IF;

  IF _reason IS NULL AND (NEW.explanation IS NULL OR length(NEW.explanation) < 20) THEN
    _reason := 'explanation_too_short';
  END IF;

  IF _reason IS NULL AND NEW.exam_part IS NULL THEN
    _reason := 'missing_exam_part';
  END IF;

  -- Rejected: log reason, stay as draft
  IF _reason IS NOT NULL THEN
    INSERT INTO exam_promotion_audit(question_id, curriculum_id, previous_status, new_status, reason_code)
    VALUES (NEW.id, NEW.curriculum_id, NEW.status, NEW.status, _reason);
    RETURN NEW;
  END IF;

  -- ── STAGE 3: Promote ──
  NEW.status := 'approved';
  
  -- Log successful promotion
  INSERT INTO exam_promotion_audit(question_id, curriculum_id, previous_status, new_status, reason_code)
  VALUES (NEW.id, NEW.curriculum_id, 'draft', 'approved', NULL);

  RETURN NEW;
END;
$$;

-- 3. Optimize: only fire on relevant column changes
DROP TRIGGER IF EXISTS trg_auto_promote_tier1_guarded ON exam_questions;

CREATE TRIGGER trg_auto_promote_tier1_guarded
  BEFORE INSERT OR UPDATE OF status, qc_status, question_text, options, explanation, 
    exam_part, difficulty, cognitive_level, competency_id, learning_field_id, correct_answer
  ON exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_promote_tier1_guarded();

-- 4. Observability view: promotion readiness per curriculum
CREATE OR REPLACE VIEW v_exam_promotion_readiness AS
SELECT
  eq.curriculum_id,
  count(*) AS total_draft_tier1,
  count(*) FILTER (WHERE
    eq.learning_field_id IS NOT NULL
    AND eq.competency_id IS NOT NULL
    AND eq.difficulty IS NOT NULL
    AND eq.cognitive_level IS NOT NULL
    AND eq.correct_answer IS NOT NULL
    AND length(eq.question_text) >= 60
    AND (eq.question_type NOT IN ('multiple_choice','mc') OR jsonb_array_length(COALESCE(eq.options,'[]'::jsonb)) >= 4)
    AND eq.explanation IS NOT NULL AND length(eq.explanation) >= 20
    AND eq.exam_part IS NOT NULL
  ) AS auto_promotable,
  count(*) FILTER (WHERE
    eq.curriculum_id IS NULL OR eq.learning_field_id IS NULL
    OR eq.competency_id IS NULL OR eq.difficulty IS NULL
    OR eq.cognitive_level IS NULL OR eq.correct_answer IS NULL
    OR eq.question_text IS NULL OR length(eq.question_text) < 10
  ) AS blocked_by_structure,
  count(*) FILTER (WHERE
    eq.curriculum_id IS NOT NULL AND eq.learning_field_id IS NOT NULL
    AND eq.competency_id IS NOT NULL AND eq.difficulty IS NOT NULL
    AND eq.cognitive_level IS NOT NULL
    AND (length(eq.question_text) < 60
         OR (eq.question_type IN ('multiple_choice','mc') AND jsonb_array_length(COALESCE(eq.options,'[]'::jsonb)) < 4)
         OR eq.explanation IS NULL OR length(eq.explanation) < 20
         OR eq.exam_part IS NULL)
  ) AS blocked_by_quality
FROM exam_questions eq
WHERE eq.status = 'draft' AND eq.qc_status = 'tier1_passed'
GROUP BY eq.curriculum_id;

-- 5. Promotion metrics view (for Leitwarte)
CREATE OR REPLACE VIEW v_exam_promotion_metrics AS
SELECT
  date_trunc('hour', epa.created_at) AS hour,
  epa.curriculum_id,
  count(*) FILTER (WHERE epa.reason_code IS NULL) AS promoted,
  count(*) FILTER (WHERE epa.reason_code IS NOT NULL) AS rejected,
  count(*) FILTER (WHERE epa.reason_code = 'question_too_short') AS rej_short_text,
  count(*) FILTER (WHERE epa.reason_code = 'mc_too_few_options') AS rej_few_options,
  count(*) FILTER (WHERE epa.reason_code = 'explanation_too_short') AS rej_weak_explanation,
  count(*) FILTER (WHERE epa.reason_code = 'missing_exam_part') AS rej_no_exam_part,
  count(*) FILTER (WHERE epa.reason_code = 'missing_mandatory_fields') AS rej_missing_fields
FROM exam_promotion_audit epa
GROUP BY 1, 2;

-- Grant access for service_role only (ops views)
REVOKE SELECT ON v_exam_promotion_readiness FROM anon, authenticated;
REVOKE SELECT ON v_exam_promotion_metrics FROM anon, authenticated;
REVOKE SELECT ON exam_promotion_audit FROM anon, authenticated;
