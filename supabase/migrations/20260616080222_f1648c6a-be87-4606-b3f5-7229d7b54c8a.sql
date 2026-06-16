
-- KIMI.INTELLIGENCE.1b-hotfix: add policy-gate columns
ALTER TABLE public.quality_intelligence_recommendations
  ADD COLUMN IF NOT EXISTS confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'locked',
  ADD COLUMN IF NOT EXISTS expected_mutation text NOT NULL DEFAULT 'manual_review_only';

-- Conditional backfill (Wave-1 safe-list only)
UPDATE public.quality_intelligence_recommendations
SET
  confidence = CASE
    WHEN priority IN ('P0','P1')
      AND action_kind IN ('expand_question_pool','enqueue_coverage_repair','enqueue_integrity_check')
    THEN 0.9
    ELSE 0.5
  END,
  risk_level = CASE
    WHEN action_kind IN ('expand_question_pool','enqueue_coverage_repair','enqueue_integrity_check')
    THEN 'low'
    ELSE 'locked'
  END,
  expected_mutation = CASE
    WHEN action_kind IN ('expand_question_pool','enqueue_coverage_repair','enqueue_integrity_check')
    THEN 'repair_job_enqueue_only'
    ELSE 'manual_review_only'
  END;

-- Default for FUTURE rows: trigger keeps semantics aligned with action_kind/priority
CREATE OR REPLACE FUNCTION public.fn_qil_recommendation_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.action_kind IN ('expand_question_pool','enqueue_coverage_repair','enqueue_integrity_check') THEN
    NEW.risk_level := COALESCE(NULLIF(NEW.risk_level,'locked'), 'low');
    IF NEW.risk_level = 'locked' THEN NEW.risk_level := 'low'; END IF;
    NEW.expected_mutation := 'repair_job_enqueue_only';
    IF NEW.confidence IS NULL OR NEW.confidence < 0.5 THEN
      NEW.confidence := CASE WHEN NEW.priority IN ('P0','P1') THEN 0.9 ELSE 0.7 END;
    END IF;
  ELSE
    NEW.risk_level := 'locked';
    NEW.expected_mutation := 'manual_review_only';
    IF NEW.confidence IS NULL THEN NEW.confidence := 0.5; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qil_recommendation_defaults ON public.quality_intelligence_recommendations;
CREATE TRIGGER trg_qil_recommendation_defaults
  BEFORE INSERT ON public.quality_intelligence_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.fn_qil_recommendation_defaults();
