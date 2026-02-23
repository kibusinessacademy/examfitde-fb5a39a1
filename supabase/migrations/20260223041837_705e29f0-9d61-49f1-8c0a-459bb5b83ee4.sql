
-- ═══════════════════════════════════════════════════════
-- Blueprint 2.0: Elite-Level Prüfungsnähe-Erweiterung
-- ═══════════════════════════════════════════════════════

-- 1) Enum: exam_context_type
CREATE TYPE public.exam_context_type AS ENUM (
  'isolated_knowledge',
  'applied_case',
  'multi_step_case',
  'prioritization',
  'error_detection',
  'documentation_analysis',
  'legal_evaluation',
  'communication_scenario'
);

-- 2) Enum: decision_structure_type
CREATE TYPE public.decision_structure_type AS ENUM (
  'single_best_answer',
  'multiple_valid_options',
  'sequence_ordering',
  'risk_assessment',
  'legal_evaluation',
  'documentation_duty',
  'prioritization'
);

-- 3) Add new columns to question_blueprints
ALTER TABLE public.question_blueprints
  ADD COLUMN exam_context_type public.exam_context_type NOT NULL DEFAULT 'isolated_knowledge',
  ADD COLUMN typical_errors jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN decision_structure public.decision_structure_type,
  ADD COLUMN exam_relevance_score smallint NOT NULL DEFAULT 3,
  ADD COLUMN oral_extension jsonb,
  ADD COLUMN remediation_triggers jsonb,
  ADD COLUMN estimated_time_seconds smallint DEFAULT 120;

-- 4) Validation trigger: exam_relevance_score must be 1-5
CREATE OR REPLACE FUNCTION public.validate_blueprint_elite_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.exam_relevance_score < 1 OR NEW.exam_relevance_score > 5 THEN
    RAISE EXCEPTION 'exam_relevance_score must be between 1 and 5, got %', NEW.exam_relevance_score;
  END IF;
  IF NEW.estimated_time_seconds IS NOT NULL AND (NEW.estimated_time_seconds < 15 OR NEW.estimated_time_seconds > 600) THEN
    RAISE EXCEPTION 'estimated_time_seconds must be between 15 and 600, got %', NEW.estimated_time_seconds;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_blueprint_elite
  BEFORE INSERT OR UPDATE ON public.question_blueprints
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_blueprint_elite_fields();

-- 5) Prüfungsnähe-Score Funktion (0-100)
CREATE OR REPLACE FUNCTION public.calculate_blueprint_exam_proximity(p_blueprint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_score int := 0;
  v_bp record;
  v_errors_count int;
BEGIN
  SELECT * INTO v_bp FROM question_blueprints WHERE id = p_blueprint_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Blueprint not found');
  END IF;

  -- 25 pts: exam_context_type != isolated_knowledge
  IF v_bp.exam_context_type != 'isolated_knowledge' THEN
    v_score := v_score + 25;
  END IF;

  -- 20 pts: cognitive_level >= apply
  IF v_bp.cognitive_level IN ('apply', 'analyze') THEN
    v_score := v_score + 20;
  END IF;

  -- 15 pts: exam_relevance_score >= 4
  IF v_bp.exam_relevance_score >= 4 THEN
    v_score := v_score + 15;
  END IF;

  -- 15 pts: >= 2 typical_errors
  v_errors_count := COALESCE(jsonb_array_length(v_bp.typical_errors), 0);
  IF v_errors_count >= 2 THEN
    v_score := v_score + 15;
  END IF;

  -- 10 pts: decision_structure defined
  IF v_bp.decision_structure IS NOT NULL THEN
    v_score := v_score + 10;
  END IF;

  -- 5 pts: estimated_time realistic (60-240s)
  IF v_bp.estimated_time_seconds BETWEEN 60 AND 240 THEN
    v_score := v_score + 5;
  END IF;

  -- 10 pts bonus: oral_extension defined
  IF v_bp.oral_extension IS NOT NULL THEN
    v_score := v_score + 10;
  END IF;

  RETURN jsonb_build_object(
    'blueprint_id', p_blueprint_id,
    'score', v_score,
    'passed', v_score >= 70,
    'tier', CASE
      WHEN v_score >= 85 THEN 'elite'
      WHEN v_score >= 70 THEN 'acceptable'
      ELSE 'rejected'
    END,
    'breakdown', jsonb_build_object(
      'context_type', CASE WHEN v_bp.exam_context_type != 'isolated_knowledge' THEN 25 ELSE 0 END,
      'bloom_level', CASE WHEN v_bp.cognitive_level IN ('apply','analyze') THEN 20 ELSE 0 END,
      'relevance', CASE WHEN v_bp.exam_relevance_score >= 4 THEN 15 ELSE 0 END,
      'errors', CASE WHEN v_errors_count >= 2 THEN 15 ELSE 0 END,
      'decision', CASE WHEN v_bp.decision_structure IS NOT NULL THEN 10 ELSE 0 END,
      'time', CASE WHEN v_bp.estimated_time_seconds BETWEEN 60 AND 240 THEN 5 ELSE 0 END,
      'oral', CASE WHEN v_bp.oral_extension IS NOT NULL THEN 10 ELSE 0 END
    )
  );
END;
$$;

-- 6) Index for efficient filtering
CREATE INDEX idx_blueprints_exam_context ON public.question_blueprints (exam_context_type);
CREATE INDEX idx_blueprints_relevance_score ON public.question_blueprints (exam_relevance_score);
