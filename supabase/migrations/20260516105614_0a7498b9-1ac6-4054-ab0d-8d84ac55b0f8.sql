-- Track 6 / Bridge 14-16 Learner-Visibility
-- Sicheres RPC für Learner: liest eigene Cognitive/Exam-Window/Forecast-Signale.

CREATE OR REPLACE FUNCTION public.learner_get_intelligence_overview(
  p_curriculum_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_cognitive jsonb;
  v_window jsonb;
  v_forecast jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('authenticated', false);
  END IF;

  -- Cognitive (Bridge 14): latest row for user (+optional curriculum)
  SELECT jsonb_build_object(
    'load_level', load_level,
    'recommended_intensity', recommended_intensity,
    'fatigue_score', fatigue_score,
    'stability_score', stability_score,
    'computed_at', computed_at
  )
  INTO v_cognitive
  FROM public.learner_cognitive_state
  WHERE user_id = v_user_id
    AND (p_curriculum_id IS NULL OR curriculum_id = p_curriculum_id OR curriculum_id IS NULL)
  ORDER BY computed_at DESC NULLS LAST
  LIMIT 1;

  -- Exam Window (Bridge 15)
  SELECT jsonb_build_object(
    'phase', phase,
    'days_to_exam', days_to_exam,
    'recommended_focus', recommended_focus,
    'intensity_recommendation', intensity_recommendation,
    'exam_date', exam_date,
    'computed_at', computed_at
  )
  INTO v_window
  FROM public.exam_window_states
  WHERE user_id = v_user_id
    AND (p_curriculum_id IS NULL OR curriculum_id = p_curriculum_id)
  ORDER BY computed_at DESC NULLS LAST
  LIMIT 1;

  -- Forecast (Bridge 16): latest status_quo scenario, horizon=7
  SELECT jsonb_build_object(
    'success_probability', f.success_probability,
    'confidence_low', f.confidence_low,
    'confidence_high', f.confidence_high,
    'readiness_projected', f.readiness_projected,
    'horizon_day', f.horizon_day,
    'created_at', f.created_at
  )
  INTO v_forecast
  FROM public.forecast_state_snapshots f
  JOIN public.scenario_simulations s ON s.id = f.scenario_id
  WHERE s.user_id = v_user_id
    AND s.scenario_key = 'status_quo'
    AND (p_curriculum_id IS NULL OR s.curriculum_id = p_curriculum_id)
  ORDER BY f.horizon_day ASC, f.created_at DESC
  LIMIT 1;

  -- Lightweight usage audit (non-blocking)
  BEGIN
    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, payload)
    VALUES (
      'learner_intelligence_overview_call',
      'user',
      v_user_id::text,
      'ok',
      jsonb_build_object('curriculum_id', p_curriculum_id, 'has_cognitive', v_cognitive IS NOT NULL, 'has_window', v_window IS NOT NULL, 'has_forecast', v_forecast IS NOT NULL)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'authenticated', true,
    'cognitive', v_cognitive,
    'exam_window', v_window,
    'forecast', v_forecast
  );
END;
$$;

REVOKE ALL ON FUNCTION public.learner_get_intelligence_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learner_get_intelligence_overview(uuid) TO authenticated;

COMMENT ON FUNCTION public.learner_get_intelligence_overview(uuid) IS
'Track 6 / Bridge 14-16 visibility. Returns own cognitive/exam-window/forecast signals for the authenticated learner. SSOT auth.uid()-scoped.';