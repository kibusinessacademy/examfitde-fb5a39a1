
CREATE TABLE IF NOT EXISTS public.tutor_intervention_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  intervention_type TEXT NOT NULL,
  tutor_mode TEXT NOT NULL CHECK (tutor_mode IN ('explainer','coach','examiner','feedback')),
  source TEXT NOT NULL DEFAULT 'empirical_nba',
  curriculum_id UUID NULL,
  blueprint_id UUID NULL,
  competency_id UUID NULL,
  lesson_id UUID NULL,
  package_id UUID NULL,
  exam_session_id UUID NULL,
  empirical_priority INT NULL,
  empirical_decision TEXT NULL,
  confidence_label TEXT NULL,
  pass_rate_lift_pp NUMERIC NULL,
  risk_bucket TEXT NULL,
  status TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN ('started','in_progress','completed','abandoned','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  readiness_score_before NUMERIC NULL,
  readiness_score_after NUMERIC NULL,
  readiness_delta NUMERIC GENERATED ALWAYS AS (
    COALESCE(readiness_score_after - readiness_score_before, NULL)
  ) STORED,
  result_summary JSONB NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tutor_session_requires_ssot_ref CHECK (
    competency_id IS NOT NULL
    OR lesson_id IS NOT NULL
    OR blueprint_id IS NOT NULL
    OR curriculum_id IS NOT NULL
    OR exam_session_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_tutor_sessions_user_status
  ON public.tutor_intervention_sessions(user_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tutor_sessions_mode
  ON public.tutor_intervention_sessions(tutor_mode, status);
CREATE INDEX IF NOT EXISTS idx_tutor_sessions_intervention
  ON public.tutor_intervention_sessions(intervention_type, started_at DESC);

ALTER TABLE public.tutor_intervention_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Learners read own tutor sessions" ON public.tutor_intervention_sessions;
CREATE POLICY "Learners read own tutor sessions"
  ON public.tutor_intervention_sessions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins read all tutor sessions" ON public.tutor_intervention_sessions;
CREATE POLICY "Admins read all tutor sessions"
  ON public.tutor_intervention_sessions FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role full access tutor sessions" ON public.tutor_intervention_sessions;
CREATE POLICY "Service role full access tutor sessions"
  ON public.tutor_intervention_sessions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE VIEW public.v_tutor_nba_context AS
SELECT
  enba.user_id,
  enba.curriculum_id,
  enba.nba_action AS intervention_type,
  enba.empirical_priority,
  enba.decision AS empirical_decision,
  enba.confidence_label,
  enba.pass_rate_lift_pp,
  enba.retention_risk AS risk_bucket,
  CASE enba.nba_action
    WHEN 'rescue_session'      THEN 'coach'
    WHEN 'exam_simulation'     THEN 'examiner'
    WHEN 'lesson_recommend'    THEN 'explainer'
    WHEN 'tutor_session'       THEN 'coach'
    WHEN 'feedback_followup'   THEN 'feedback'
    WHEN 'oral_exam_practice'  THEN 'examiner'
    ELSE 'explainer'
  END AS tutor_mode,
  lrh.readiness_score AS current_readiness,
  lrh.verdict AS readiness_verdict
FROM public.v_empirical_next_best_action enba
LEFT JOIN LATERAL (
  SELECT readiness_score, verdict
  FROM public.learner_readiness_history
  WHERE user_id = enba.user_id
  ORDER BY computed_at DESC
  LIMIT 1
) lrh ON true
WHERE enba.decision IN ('prefer','neutral','safety_fallback');

REVOKE ALL ON public.v_tutor_nba_context FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_tutor_nba_context TO service_role;

CREATE OR REPLACE FUNCTION public.fn_start_tutor_intervention(
  p_user_id UUID,
  p_intervention_type TEXT,
  p_tutor_mode TEXT,
  p_curriculum_id UUID DEFAULT NULL,
  p_blueprint_id UUID DEFAULT NULL,
  p_competency_id UUID DEFAULT NULL,
  p_lesson_id UUID DEFAULT NULL,
  p_package_id UUID DEFAULT NULL,
  p_exam_session_id UUID DEFAULT NULL,
  p_source TEXT DEFAULT 'empirical_nba'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_priority INT;
  v_decision TEXT;
  v_confidence TEXT;
  v_lift NUMERIC;
  v_risk TEXT;
  v_readiness NUMERIC;
BEGIN
  IF p_competency_id IS NULL AND p_lesson_id IS NULL
     AND p_blueprint_id IS NULL AND p_curriculum_id IS NULL
     AND p_exam_session_id IS NULL THEN
    RAISE EXCEPTION 'tutor_intervention requires at least one SSOT binding';
  END IF;

  SELECT empirical_priority, decision, confidence_label, pass_rate_lift_pp, retention_risk
  INTO v_priority, v_decision, v_confidence, v_lift, v_risk
  FROM public.v_empirical_next_best_action
  WHERE user_id = p_user_id
    AND nba_action = p_intervention_type
  ORDER BY empirical_priority DESC NULLS LAST
  LIMIT 1;

  SELECT readiness_score INTO v_readiness
  FROM public.learner_readiness_history
  WHERE user_id = p_user_id
  ORDER BY computed_at DESC
  LIMIT 1;

  INSERT INTO public.tutor_intervention_sessions (
    user_id, intervention_type, tutor_mode, source,
    curriculum_id, blueprint_id, competency_id, lesson_id, package_id, exam_session_id,
    empirical_priority, empirical_decision, confidence_label, pass_rate_lift_pp, risk_bucket,
    readiness_score_before
  ) VALUES (
    p_user_id, p_intervention_type, p_tutor_mode, p_source,
    p_curriculum_id, p_blueprint_id, p_competency_id, p_lesson_id, p_package_id, p_exam_session_id,
    v_priority, v_decision, v_confidence, v_lift, v_risk,
    v_readiness
  )
  RETURNING id INTO v_session_id;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'tutor_intervention_started', 'tutor_session', v_session_id, 'ok',
    jsonb_build_object(
      'user_id', p_user_id,
      'intervention_type', p_intervention_type,
      'tutor_mode', p_tutor_mode,
      'source', p_source,
      'empirical_priority', v_priority,
      'empirical_decision', v_decision
    )
  );

  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_start_tutor_intervention(UUID,TEXT,TEXT,UUID,UUID,UUID,UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_start_tutor_intervention(UUID,TEXT,TEXT,UUID,UUID,UUID,UUID,UUID,UUID,TEXT) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.fn_complete_tutor_intervention(
  p_session_id UUID,
  p_status TEXT DEFAULT 'completed',
  p_result_summary JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.tutor_intervention_sessions;
  v_readiness NUMERIC;
BEGIN
  SELECT * INTO v_row FROM public.tutor_intervention_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tutor session % not found', p_session_id;
  END IF;

  SELECT readiness_score INTO v_readiness
  FROM public.learner_readiness_history
  WHERE user_id = v_row.user_id
  ORDER BY computed_at DESC
  LIMIT 1;

  UPDATE public.tutor_intervention_sessions
  SET status = p_status,
      completed_at = now(),
      readiness_score_after = v_readiness,
      result_summary = COALESCE(p_result_summary, result_summary)
  WHERE id = p_session_id;

  BEGIN
    INSERT INTO public.learner_intervention_dispatch_log (
      user_id, intervention_type, source, metadata
    ) VALUES (
      v_row.user_id, v_row.intervention_type, 'tutor_v2',
      jsonb_build_object(
        'tutor_session_id', p_session_id,
        'tutor_mode', v_row.tutor_mode,
        'status', p_status,
        'competency_id', v_row.competency_id,
        'lesson_id', v_row.lesson_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'tutor_intervention_completed', 'tutor_session', p_session_id,
    CASE WHEN p_status = 'completed' THEN 'ok' ELSE 'partial' END,
    jsonb_build_object(
      'user_id', v_row.user_id,
      'tutor_mode', v_row.tutor_mode,
      'intervention_type', v_row.intervention_type,
      'readiness_before', v_row.readiness_score_before,
      'readiness_after', v_readiness,
      'final_status', p_status
    )
  );

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'status', p_status,
    'readiness_before', v_row.readiness_score_before,
    'readiness_after', v_readiness
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_complete_tutor_intervention(UUID,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_complete_tutor_intervention(UUID,TEXT,JSONB) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_tutor_intervention_health(
  p_days INT DEFAULT 14
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  WITH base AS (
    SELECT * FROM public.tutor_intervention_sessions
    WHERE started_at >= now() - make_interval(days => p_days)
  ),
  by_mode AS (
    SELECT tutor_mode,
           COUNT(*) AS sessions,
           COUNT(*) FILTER (WHERE status = 'completed') AS completed,
           COUNT(*) FILTER (WHERE status = 'abandoned') AS abandoned,
           ROUND(AVG(readiness_delta) FILTER (WHERE readiness_delta IS NOT NULL)::numeric, 2) AS avg_readiness_delta
    FROM base
    GROUP BY tutor_mode
  ),
  by_intervention AS (
    SELECT intervention_type,
           COUNT(*) AS sessions,
           ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completed') / NULLIF(COUNT(*),0), 1) AS completion_rate_pct,
           ROUND(AVG(readiness_delta) FILTER (WHERE readiness_delta IS NOT NULL)::numeric, 2) AS avg_readiness_delta
    FROM base
    GROUP BY intervention_type
    ORDER BY sessions DESC
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'window_days', p_days,
    'totals', jsonb_build_object(
      'sessions', (SELECT COUNT(*) FROM base),
      'completed', (SELECT COUNT(*) FROM base WHERE status='completed'),
      'completion_rate_pct', (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status='completed') / NULLIF(COUNT(*),0), 1) FROM base),
      'avg_readiness_delta', (SELECT ROUND(AVG(readiness_delta)::numeric, 2) FROM base WHERE readiness_delta IS NOT NULL)
    ),
    'by_mode', COALESCE((SELECT jsonb_agg(to_jsonb(by_mode)) FROM by_mode), '[]'::jsonb),
    'by_intervention', COALESCE((SELECT jsonb_agg(to_jsonb(by_intervention)) FROM by_intervention), '[]'::jsonb),
    'computed_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_tutor_intervention_health(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_tutor_intervention_health(INT) TO authenticated, service_role;
