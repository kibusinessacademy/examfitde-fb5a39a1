
-- Add trap_definition JSONB to question_blueprints
ALTER TABLE public.question_blueprints
ADD COLUMN IF NOT EXISTS trap_definition JSONB;

COMMENT ON COLUMN public.question_blueprints.trap_definition IS 
'SSOT trap definition: error_model, student_thought, wrong_patterns, distractor_rules, explanation_hint';

-- Backfill trap_definition from existing trap_spec + typical_errors
UPDATE public.question_blueprints
SET trap_definition = jsonb_build_object(
  'error_model', COALESCE(trap_spec->>'common_misconception', 'Typischer Prüfungsfehler'),
  'student_thought', COALESCE(trap_spec->>'why_tempting', 'Antwort klingt plausibel'),
  'wrong_patterns', COALESCE(to_jsonb(typical_errors), '[]'::jsonb),
  'distractor_rules', jsonb_build_array(
    COALESCE(trap_spec->>'examiner_intention', 'Prüft Anwendungskompetenz')
  ),
  'explanation_hint', COALESCE(trap_spec->>'common_misconception', ''),
  'trap_taxonomy', COALESCE(trap_spec->>'trap_type', 'isolated_knowledge')
)
WHERE trap_spec IS NOT NULL AND trap_definition IS NULL;

-- Quality Gate: Enforce trap_type on approved questions (80%+ coverage)
CREATE OR REPLACE FUNCTION public.check_trap_coverage_gate(p_package_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_with_trap INT;
  v_coverage NUMERIC;
  v_distribution JSONB;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE trap_type IS NOT NULL)
  INTO v_total, v_with_trap
  FROM exam_questions
  WHERE package_id = p_package_id AND status = 'approved';

  IF v_total = 0 THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'NO_APPROVED_QUESTIONS', 'total', 0);
  END IF;

  v_coverage := round(100.0 * v_with_trap / v_total, 1);

  SELECT jsonb_object_agg(trap_type, cnt)
  INTO v_distribution
  FROM (
    SELECT trap_type, count(*) as cnt
    FROM exam_questions
    WHERE package_id = p_package_id AND status = 'approved' AND trap_type IS NOT NULL
    GROUP BY trap_type
  ) t;

  RETURN jsonb_build_object(
    'passed', v_coverage >= 80,
    'coverage_pct', v_coverage,
    'total', v_total,
    'with_trap', v_with_trap,
    'distribution', COALESCE(v_distribution, '{}'::jsonb),
    'gate_threshold', 80
  );
END;
$$;
