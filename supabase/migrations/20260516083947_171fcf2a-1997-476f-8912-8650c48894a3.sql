
-- =========================================================
-- Bridge 5 — Predictive Exam Intelligence (SSOT)
-- =========================================================

-- 1) Outcome ledger ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_outcome_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  package_id uuid,
  source text NOT NULL CHECK (source IN ('exam_sim','final_exam','external_report','self_report')),
  source_ref uuid,
  outcome text NOT NULL CHECK (outcome IN ('pass','fail','partial','unknown')),
  score_percentage numeric,
  pass_probability_at_end numeric,
  readiness_score_at_attempt numeric,
  readiness_verdict_at_attempt text,
  days_since_activation integer,
  total_minichecks_completed integer,
  total_sim_attempts integer,
  weak_competency_ids uuid[] DEFAULT '{}',
  strong_competency_ids uuid[] DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_outcome_user_curr ON public.exam_outcome_events(user_id, curriculum_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_outcome_curr_outcome ON public.exam_outcome_events(curriculum_id, outcome, occurred_at DESC);

ALTER TABLE public.exam_outcome_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outcome_events_self_read"
  ON public.exam_outcome_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "outcome_events_admin_read"
  ON public.exam_outcome_events FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 2) Path-Pattern aggregate -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learner_path_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL,
  pattern_key text NOT NULL,
  pattern_kind text NOT NULL CHECK (pattern_kind IN ('lesson_sequence','sim_frequency','tutor_usage','weakness_drill','combo')),
  pattern_signature jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_count integer NOT NULL DEFAULT 0,
  pass_count integer NOT NULL DEFAULT 0,
  fail_count integer NOT NULL DEFAULT 0,
  pass_rate numeric GENERATED ALWAYS AS (
    CASE WHEN sample_count > 0 THEN ROUND((pass_count::numeric / sample_count) * 100, 2) ELSE NULL END
  ) STORED,
  success_correlation numeric,
  last_recomputed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(curriculum_id, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_learner_path_patterns_curr ON public.learner_path_patterns(curriculum_id, success_correlation DESC NULLS LAST);

ALTER TABLE public.learner_path_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "path_patterns_admin_read"
  ON public.learner_path_patterns FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3) Trigger: exam_sessions finished → outcome event ------------------------
CREATE OR REPLACE FUNCTION public.fn_exam_session_to_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_outcome text;
  v_readiness numeric;
  v_verdict text;
  v_days integer;
BEGIN
  -- only fire when a session becomes finished
  IF NEW.finished_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.finished_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  IF NEW.passed IS TRUE THEN
    v_outcome := 'pass';
  ELSIF NEW.passed IS FALSE THEN
    v_outcome := 'fail';
  ELSE
    v_outcome := 'unknown';
  END IF;

  -- latest readiness snapshot at attempt time (best-effort)
  BEGIN
    SELECT readiness_score, verdict
      INTO v_readiness, v_verdict
    FROM public.learner_readiness_history
    WHERE user_id = NEW.user_id AND curriculum_id = NEW.curriculum_id
    ORDER BY computed_at DESC
    LIMIT 1;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_readiness := NULL; v_verdict := NULL;
  END;

  BEGIN
    SELECT EXTRACT(DAY FROM (NEW.finished_at - g.activated_at))::int
      INTO v_days
    FROM public.learner_course_grants g
    WHERE g.user_id = NEW.user_id AND g.curriculum_id = NEW.curriculum_id AND g.activated_at IS NOT NULL
    ORDER BY g.activated_at ASC
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_days := NULL;
  END;

  INSERT INTO public.exam_outcome_events(
    user_id, curriculum_id, package_id, source, source_ref,
    outcome, score_percentage, pass_probability_at_end,
    readiness_score_at_attempt, readiness_verdict_at_attempt,
    days_since_activation, metadata, occurred_at
  ) VALUES (
    NEW.user_id, NEW.curriculum_id, NEW.package_id,
    'exam_sim', NEW.id,
    v_outcome, NEW.score_percentage, NEW.pass_probability_at_end,
    v_readiness, v_verdict,
    v_days,
    jsonb_build_object('mode', NEW.mode, 'total_questions', NEW.total_questions, 'theta_at_end', NEW.theta_at_end),
    NEW.finished_at
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exam_session_to_outcome ON public.exam_sessions;
CREATE TRIGGER trg_exam_session_to_outcome
AFTER INSERT OR UPDATE OF finished_at, passed ON public.exam_sessions
FOR EACH ROW EXECUTE FUNCTION public.fn_exam_session_to_outcome();

-- 4) Drivers View -----------------------------------------------------------
CREATE OR REPLACE VIEW public.v_exam_success_drivers AS
WITH base AS (
  SELECT
    e.curriculum_id,
    COUNT(*)::int AS attempts,
    COUNT(*) FILTER (WHERE e.outcome='pass')::int AS passes,
    COUNT(*) FILTER (WHERE e.outcome='fail')::int AS fails,
    AVG(NULLIF(e.score_percentage,0))::numeric(6,2) AS avg_score,
    AVG(e.readiness_score_at_attempt)::numeric(6,2) AS avg_readiness_at_attempt,
    AVG(e.days_since_activation)::numeric(6,2) AS avg_days_since_activation
  FROM public.exam_outcome_events e
  WHERE e.occurred_at > now() - interval '180 days'
  GROUP BY e.curriculum_id
),
weak_drivers AS (
  SELECT
    e.curriculum_id,
    unnest(e.weak_competency_ids) AS competency_id,
    e.outcome
  FROM public.exam_outcome_events e
  WHERE e.occurred_at > now() - interval '180 days'
    AND array_length(e.weak_competency_ids,1) > 0
),
weak_agg AS (
  SELECT
    curriculum_id, competency_id,
    COUNT(*)::int AS appears_in_attempts,
    COUNT(*) FILTER (WHERE outcome='fail')::int AS fail_appearances,
    ROUND(
      (COUNT(*) FILTER (WHERE outcome='fail')::numeric / NULLIF(COUNT(*),0)) * 100, 2
    ) AS fail_rate_when_weak
  FROM weak_drivers
  GROUP BY curriculum_id, competency_id
)
SELECT
  b.curriculum_id,
  b.attempts,
  b.passes,
  b.fails,
  ROUND((b.passes::numeric / NULLIF(b.attempts,0)) * 100, 2) AS pass_rate_pct,
  b.avg_score,
  b.avg_readiness_at_attempt,
  b.avg_days_since_activation,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'competency_id', w.competency_id,
      'fail_rate_when_weak', w.fail_rate_when_weak,
      'appears_in_attempts', w.appears_in_attempts
    ) ORDER BY w.fail_rate_when_weak DESC NULLS LAST)
    FROM (
      SELECT * FROM weak_agg w2
      WHERE w2.curriculum_id = b.curriculum_id
      ORDER BY w2.fail_rate_when_weak DESC NULLS LAST
      LIMIT 10
    ) w
  ) AS top_failure_drivers
FROM base b;

REVOKE ALL ON public.v_exam_success_drivers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_exam_success_drivers TO service_role;

-- 5) Admin RPC --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_exam_success_drivers()
RETURNS TABLE (
  curriculum_id uuid,
  attempts int,
  passes int,
  fails int,
  pass_rate_pct numeric,
  avg_score numeric,
  avg_readiness_at_attempt numeric,
  avg_days_since_activation numeric,
  top_failure_drivers jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT * FROM public.v_exam_success_drivers
    ORDER BY attempts DESC NULLS LAST
    LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_exam_success_drivers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_exam_success_drivers() TO authenticated;

-- 6) Audit
INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES ('bridge_5_predictive_exam_intelligence_init', 'system', 'success',
  jsonb_build_object('bridge','5','components',ARRAY['exam_outcome_events','learner_path_patterns','v_exam_success_drivers','trg_exam_session_to_outcome','admin_get_exam_success_drivers']));
