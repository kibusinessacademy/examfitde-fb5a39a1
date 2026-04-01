
CREATE OR REPLACE FUNCTION public.get_next_best_action(
  p_user_id uuid,
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total int;
  v_mastered int;
  v_partial int;
  v_weak int;
  v_mastery_pct numeric;
  v_last_sim_score numeric;
  v_readiness numeric;
  v_risk text;
  v_weakest_comp record;
  v_has_any_progress boolean;
  v_last_exam record;
  v_days_until_exam int;
  v_exam_date date;
BEGIN
  -- 1. Mastery state
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE mastery_level = 'mastered'),
    COUNT(*) FILTER (WHERE mastery_level = 'partial'),
    COUNT(*) FILTER (WHERE mastery_level = 'not_mastered')
  INTO v_total, v_mastered, v_partial, v_weak
  FROM user_competency_progress
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;

  -- 2. Check if user has any learning activity at all
  SELECT EXISTS(
    SELECT 1 FROM learning_progress lp
    JOIN lessons l ON l.id = lp.lesson_id
    JOIN modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id
    WHERE lp.user_id = p_user_id AND c.curriculum_id = p_curriculum_id
    LIMIT 1
  ) INTO v_has_any_progress;

  -- STATE: No data at all → Onboarding
  IF v_total = 0 AND NOT v_has_any_progress THEN
    RETURN jsonb_build_object(
      'action', 'ONBOARDING',
      'headline', 'Starte dein Prüfungstraining',
      'subline', 'Finde heraus, wo du stehst – dein persönlicher Diagnosetest dauert nur 5 Minuten.',
      'cta', 'Diagnosetest starten',
      'route', '/diagnostic/' || p_curriculum_id,
      'readiness_score', 0,
      'risk_level', 'high',
      'bottleneck', null,
      'intent', 'onboarding'
    );
  END IF;

  -- 3. Compute readiness
  v_mastery_pct := CASE WHEN v_total > 0
    THEN round((v_mastered + v_partial * 0.5) * 100.0 / v_total, 1)
    ELSE 0 END;

  SELECT score INTO v_last_sim_score
  FROM exam_attempts
  WHERE user_id = p_user_id
  ORDER BY completed_at DESC NULLS LAST
  LIMIT 1;

  v_readiness := round(v_mastery_pct * 0.7 + COALESCE(v_last_sim_score, 0) * 0.3, 1);
  v_risk := CASE
    WHEN v_readiness >= 75 THEN 'low'
    WHEN v_readiness >= 50 THEN 'medium'
    ELSE 'high'
  END;

  -- 4. Find weakest competency (bottleneck)
  SELECT
    ucp.competency_id,
    COALESCE(comp.title, comp.code, 'Unbekannt') as comp_title,
    COALESCE(lf.title, '') as lf_title,
    ucp.score
  INTO v_weakest_comp
  FROM user_competency_progress ucp
  LEFT JOIN competencies comp ON comp.id = ucp.competency_id
  LEFT JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE ucp.user_id = p_user_id
    AND ucp.curriculum_id = p_curriculum_id
    AND ucp.mastery_level IN ('not_mastered', 'partial')
  ORDER BY ucp.score ASC NULLS FIRST
  LIMIT 1;

  -- 5. Check exam date proximity
  SELECT exam_date INTO v_exam_date
  FROM learner_diagnostics
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;

  IF v_exam_date IS NOT NULL THEN
    v_days_until_exam := v_exam_date - CURRENT_DATE;
  END IF;

  -- 6. Last exam result for feedback loop
  SELECT score_percentage, passed, finished_at
  INTO v_last_exam
  FROM exam_sessions
  WHERE user_id = p_user_id
    AND curriculum_id = p_curriculum_id
    AND finished_at IS NOT NULL
  ORDER BY finished_at DESC
  LIMIT 1;

  -- ══════════════════════════════════════
  -- DETERMINISTIC STATE MACHINE
  -- ══════════════════════════════════════

  -- PRIORITY 1: Exam in < 7 days + not ready → Crash-Kurs
  IF v_days_until_exam IS NOT NULL AND v_days_until_exam <= 7 AND v_readiness < 75 THEN
    RETURN jsonb_build_object(
      'action', 'CRASH_COURSE',
      'headline', 'Prüfung in ' || v_days_until_exam || ' Tagen',
      'subline', 'Konzentrier dich jetzt auf deine ' || v_weak || ' schwachen Kompetenzen.',
      'cta', 'Crash-Training starten',
      'route', '/exam-simulation?mode=weakness',
      'readiness_score', v_readiness,
      'risk_level', v_risk,
      'bottleneck', CASE WHEN v_weakest_comp IS NOT NULL THEN
        jsonb_build_object('id', v_weakest_comp.competency_id, 'title', v_weakest_comp.comp_title, 'field', v_weakest_comp.lf_title, 'score', v_weakest_comp.score)
      ELSE null END,
      'intent', 'weakness_training'
    );
  END IF;

  -- PRIORITY 2: High risk (< 50%) → Weakness Training
  IF v_risk = 'high' AND v_weakest_comp IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action', 'WEAKNESS_TRAINING',
      'headline', 'Du bist noch nicht prüfungsreif',
      'subline', 'Dein Engpass: ' || v_weakest_comp.comp_title || ' (' || COALESCE(v_weakest_comp.score, 0) || '%). Trainiere das gezielt.',
      'cta', 'Schwäche trainieren',
      'route', '/exam-simulation?mode=weakness',
      'readiness_score', v_readiness,
      'risk_level', v_risk,
      'bottleneck', jsonb_build_object('id', v_weakest_comp.competency_id, 'title', v_weakest_comp.comp_title, 'field', v_weakest_comp.lf_title, 'score', v_weakest_comp.score),
      'intent', 'weakness_training'
    );
  END IF;

  -- PRIORITY 3: Medium risk (50-74%) → Simulation
  IF v_risk = 'medium' THEN
    RETURN jsonb_build_object(
      'action', 'EXAM_SIMULATION',
      'headline', 'Du bist fast prüfungsreif (' || round(v_readiness) || '%)',
      'subline', CASE WHEN v_weakest_comp IS NOT NULL
        THEN 'Noch unsicher bei: ' || v_weakest_comp.comp_title || '. Simuliere eine Prüfung.'
        ELSE 'Teste dich unter Echtbedingungen.' END,
      'cta', 'Prüfung simulieren',
      'route', '/exam-simulation',
      'readiness_score', v_readiness,
      'risk_level', v_risk,
      'bottleneck', CASE WHEN v_weakest_comp IS NOT NULL THEN
        jsonb_build_object('id', v_weakest_comp.competency_id, 'title', v_weakest_comp.comp_title, 'field', v_weakest_comp.lf_title, 'score', v_weakest_comp.score)
      ELSE null END,
      'intent', 'exam_simulation'
    );
  END IF;

  -- PRIORITY 4: Low risk (>= 75%) → Final exam
  RETURN jsonb_build_object(
    'action', 'EXAM_FINAL',
    'headline', 'Du bist prüfungsreif! (' || round(v_readiness) || '%)',
    'subline', 'Simuliere jetzt die Abschlussprüfung unter echten Bedingungen.',
    'cta', 'Abschlussprüfung starten',
    'route', '/exam-simulation',
    'readiness_score', v_readiness,
    'risk_level', v_risk,
    'bottleneck', null,
    'intent', 'exam_final'
  );
END;
$function$;
