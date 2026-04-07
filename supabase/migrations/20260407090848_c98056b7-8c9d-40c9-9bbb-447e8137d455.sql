
-- Fix fn_calculate_pass_probability with defensive casts and explicit variables
CREATE OR REPLACE FUNCTION public.fn_calculate_pass_probability(
  p_user_id UUID DEFAULT NULL,
  p_curriculum_id UUID DEFAULT NULL,
  p_self_assessment JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Explicit variables instead of fragile RECORD
  v_overall_readiness NUMERIC;
  v_predicted_score NUMERIC;
  v_weak_areas JSONB;
  v_strong_areas JSONB;
  v_trend TEXT;
  v_days_until_ready INT;
  v_sessions_count INT := 0;
  v_avg_score NUMERIC := 0;
  v_probability NUMERIC;
  v_recommendation TEXT;
  v_data_quality TEXT;
  -- Safe self-assessment values
  v_study_hours NUMERIC;
  v_weeks_until NUMERIC;
  v_confidence NUMERIC;
  v_has_practiced BOOLEAN;
  v_has_course BOOLEAN;
BEGIN
  IF p_user_id IS NOT NULL AND p_curriculum_id IS NOT NULL THEN
    -- Use real data with explicit variable assignment
    SELECT rs.overall_readiness, rs.predicted_exam_score, rs.weak_areas, rs.strong_areas, rs.trend, rs.days_until_ready
    INTO v_overall_readiness, v_predicted_score, v_weak_areas, v_strong_areas, v_trend, v_days_until_ready
    FROM readiness_scores rs
    WHERE rs.user_id = p_user_id AND rs.curriculum_id = p_curriculum_id
    ORDER BY rs.calculated_at DESC LIMIT 1;

    SELECT COUNT(*), COALESCE(AVG(es.score_percentage), 0)
    INTO v_sessions_count, v_avg_score
    FROM exam_sessions es
    WHERE es.user_id = p_user_id AND es.curriculum_id = p_curriculum_id
      AND es.status = 'completed';

    IF v_overall_readiness IS NOT NULL THEN
      v_probability := LEAST(99, GREATEST(5,
        v_overall_readiness * 0.4 +
        COALESCE(v_predicted_score, 50) * 0.3 +
        COALESCE(v_avg_score, 50) * 0.2 +
        CASE WHEN v_sessions_count > 5 THEN 10 ELSE v_sessions_count * 2 END
      ));
      v_data_quality := 'high';
    ELSE
      -- No readiness data yet, use session averages if available
      IF v_sessions_count > 0 THEN
        v_probability := LEAST(85, GREATEST(15, v_avg_score * 0.8 + v_sessions_count * 1.5));
        v_data_quality := 'medium';
      ELSE
        v_probability := 30;
        v_data_quality := 'low';
      END IF;
      v_weak_areas := '[]'::JSONB;
      v_trend := 'unknown';
    END IF;
  ELSE
    -- Anonymous: Defensive casts with NULLIF to prevent bad input
    BEGIN
      v_study_hours := COALESCE(
        CASE WHEN NULLIF(TRIM(p_self_assessment->>'study_hours_per_week'), '') IS NOT NULL
             THEN (NULLIF(TRIM(p_self_assessment->>'study_hours_per_week'), ''))::NUMERIC
             ELSE NULL END,
        5
      );
      v_weeks_until := COALESCE(
        CASE WHEN NULLIF(TRIM(p_self_assessment->>'weeks_until_exam'), '') IS NOT NULL
             THEN (NULLIF(TRIM(p_self_assessment->>'weeks_until_exam'), ''))::NUMERIC
             ELSE NULL END,
        8
      );
      v_confidence := COALESCE(
        CASE WHEN NULLIF(TRIM(p_self_assessment->>'confidence'), '') IS NOT NULL
             THEN LEAST(10, GREATEST(1, (NULLIF(TRIM(p_self_assessment->>'confidence'), ''))::NUMERIC))
             ELSE NULL END,
        5
      );
      v_has_practiced := COALESCE(
        CASE WHEN LOWER(COALESCE(p_self_assessment->>'has_practiced', '')) IN ('true', '1', 'yes', 'ja') THEN true ELSE false END,
        false
      );
      v_has_course := COALESCE(
        CASE WHEN LOWER(COALESCE(p_self_assessment->>'has_course', '')) IN ('true', '1', 'yes', 'ja') THEN true ELSE false END,
        false
      );
    EXCEPTION WHEN OTHERS THEN
      -- Fallback on any cast error
      v_study_hours := 5;
      v_weeks_until := 8;
      v_confidence := 5;
      v_has_practiced := false;
      v_has_course := false;
    END;

    v_probability := LEAST(95, GREATEST(10,
      v_study_hours * 3 +
      v_weeks_until * 0.5 +
      v_confidence * 5 +
      CASE WHEN v_has_practiced THEN 15 ELSE 0 END +
      CASE WHEN v_has_course THEN 10 ELSE 0 END
    ));
    v_weak_areas := '[]'::JSONB;
    v_trend := 'unknown';
    v_data_quality := 'self_assessment';
  END IF;

  v_recommendation := CASE
    WHEN v_probability >= 80 THEN 'Du bist gut vorbereitet! Fokussiere dich auf Prüfungssimulationen zur Festigung.'
    WHEN v_probability >= 60 THEN 'Gute Basis! Arbeite gezielt an deinen Schwachstellen und mache regelmäßig Übungsprüfungen.'
    WHEN v_probability >= 40 THEN 'Du bist auf dem Weg, aber brauchst noch mehr Übung. Starte mit den Grundlagen.'
    ELSE 'Intensive Vorbereitung empfohlen. ExamFit hilft dir mit einem strukturierten Lernplan.'
  END;

  RETURN jsonb_build_object(
    'pass_probability', round(v_probability, 1),
    'label', CASE
      WHEN v_probability >= 80 THEN 'Sehr gute Chancen'
      WHEN v_probability >= 60 THEN 'Gute Chancen'
      WHEN v_probability >= 40 THEN 'Ausbaufähig'
      ELSE 'Intensives Training nötig'
    END,
    'trend', COALESCE(v_trend, 'unknown'),
    'weak_areas', COALESCE(v_weak_areas, '[]'::JSONB),
    'recommendation', v_recommendation,
    'sessions_completed', v_sessions_count,
    'avg_score', round(COALESCE(v_avg_score, 0), 1),
    'data_quality', v_data_quality
  );
END;
$$;
