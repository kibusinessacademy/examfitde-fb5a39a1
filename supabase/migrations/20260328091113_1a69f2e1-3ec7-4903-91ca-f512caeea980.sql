
-- SSOT View: Only show exam simulations from published, integrity+council-approved packages
-- with enough approved questions and at least one active blueprint
CREATE OR REPLACE VIEW public.v_learner_visible_exam_simulations AS
WITH approved_exam_counts AS (
  SELECT eq.curriculum_id, COUNT(*) AS approved_question_count
  FROM public.exam_questions eq
  WHERE eq.status = 'approved'
  GROUP BY eq.curriculum_id
)
SELECT
  eb.id AS blueprint_id,
  eb.curriculum_id,
  eb.title,
  eb.description,
  eb.total_questions,
  eb.time_limit_minutes,
  eb.pass_threshold,
  eb.difficulty_distribution,
  cp.id AS package_id,
  cp.status AS package_status,
  COALESCE(aec.approved_question_count, 0) AS approved_question_count
FROM public.exam_blueprints eb
JOIN public.course_packages cp
  ON cp.curriculum_id = eb.curriculum_id
  AND cp.status = 'published'
  AND COALESCE(cp.integrity_passed, false) = true
  AND COALESCE(cp.council_approved, false) = true
LEFT JOIN approved_exam_counts aec
  ON aec.curriculum_id = eb.curriculum_id
WHERE
  eb.frozen = true
  AND COALESCE(aec.approved_question_count, 0) >= 40;

-- RPC for Learner UI to fetch visible simulations
CREATE OR REPLACE FUNCTION public.get_learner_visible_exam_simulations()
RETURNS TABLE (
  blueprint_id uuid,
  curriculum_id uuid,
  title text,
  description text,
  total_questions integer,
  time_limit_minutes integer,
  pass_threshold numeric,
  difficulty_distribution jsonb,
  package_id uuid,
  approved_question_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.blueprint_id,
    v.curriculum_id,
    v.title,
    v.description,
    v.total_questions,
    v.time_limit_minutes,
    v.pass_threshold,
    v.difficulty_distribution,
    v.package_id,
    v.approved_question_count
  FROM public.v_learner_visible_exam_simulations v
  ORDER BY v.title ASC;
$$;

REVOKE ALL ON FUNCTION public.get_learner_visible_exam_simulations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_learner_visible_exam_simulations() TO authenticated;

-- Start-Guard: server-side validation before starting a simulation
CREATE OR REPLACE FUNCTION public.can_start_exam_simulation(p_blueprint_id uuid)
RETURNS TABLE (
  allowed boolean,
  reason_code text,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.v_learner_visible_exam_simulations
    WHERE blueprint_id = p_blueprint_id
  ) THEN
    RETURN QUERY SELECT false, 'SIMULATION_NOT_AVAILABLE'::text, 'Diese Prüfungssimulation ist derzeit nicht verfügbar.'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'OK'::text, 'Simulation startbar.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.can_start_exam_simulation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_start_exam_simulation(uuid) TO authenticated;
