
-- ══════════════════════════════════════════════════════
-- v2: get_next_best_action – hardened state machine
-- ══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_next_best_action(
  p_user_id uuid,
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_mastered int;
  v_partial int;
  v_weak int;
  v_mastery_pct numeric;
  v_sim_trend_score numeric;
  v_readiness numeric;
  v_risk text;
  v_weakest_comp record;
  v_has_any_progress boolean;
  v_has_any_exams boolean;
  v_has_any_competency boolean;
  v_days_until_exam int;
  v_exam_date date;
  v_critical_block record;
  v_due_repetitions int;
  v_incomplete_lesson record;
  v_result jsonb;
BEGIN
  -- ═══ GATE 0: Robust ONBOARDING detection ═══
  -- Check ALL three signals independently
  
  SELECT EXISTS(
    SELECT 1 FROM user_competency_progress
    WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
    LIMIT 1
  ) INTO v_has_any_competency;

  SELECT EXISTS(
    SELECT 1 FROM learning_progress lp
    JOIN lessons l ON l.id = lp.lesson_id
    JOIN modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id
    WHERE lp.user_id = p_user_id AND c.curriculum_id = p_curriculum_id
    LIMIT 1
  ) INTO v_has_any_progress;

  SELECT EXISTS(
    SELECT 1 FROM exam_sessions
    WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
      AND finished_at IS NOT NULL
    LIMIT 1
  ) INTO v_has_any_exams;

  -- ONBOARDING: No competency data AND no progress AND no exams
  IF NOT v_has_any_competency AND NOT v_has_any_progress AND NOT v_has_any_exams THEN
    RETURN jsonb_build_object(
      'action', 'ONBOARDING',
      'headline', 'Starte dein Prüfungstraining',
      'subline', 'Finde heraus, wo du stehst – dein persönlicher Diagnosetest dauert nur 5 Minuten.',
      'cta', 'Diagnosetest starten',
      'route', '/diagnostic/' || p_curriculum_id,
      'readiness_score', 0,
      'risk_level', 'high',
      'bottleneck', null::jsonb,
      'intent', 'onboarding',
      'route_payload', jsonb_build_object(
        'curriculum_id', p_curriculum_id,
        'intent', 'onboarding'
      )
    );
  END IF;

  -- ═══ 1. Mastery state ═══
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE mastery_level = 'mastered'),
    COUNT(*) FILTER (WHERE mastery_level = 'partial'),
    COUNT(*) FILTER (WHERE mastery_level = 'not_mastered')
  INTO v_total, v_mastered, v_partial, v_weak
  FROM user_competency_progress
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;

  -- ═══ 2. Readiness with trend-based sim score ═══
  v_mastery_pct := CASE WHEN v_total > 0
    THEN round((v_mastered + v_partial * 0.5) * 100.0 / v_total, 1)
    ELSE 0 END;

  -- Use median of last 3 sim scores with recency weighting
  SELECT round(
    COALESCE(
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY sub.weighted_score)
       FROM (
         SELECT es.score_percentage * 
           CASE 
             WHEN ROW_NUMBER() OVER (ORDER BY es.finished_at DESC) = 1 THEN 1.0
             WHEN ROW_NUMBER() OVER (ORDER BY es.finished_at DESC) = 2 THEN 0.8
             ELSE 0.6
           END as weighted_score
         FROM exam_sessions es
         WHERE es.user_id = p_user_id
           AND es.curriculum_id = p_curriculum_id
           AND es.finished_at IS NOT NULL
           AND es.score_percentage IS NOT NULL
         ORDER BY es.finished_at DESC
         LIMIT 3
       ) sub
      ),
      0
    ), 1
  ) INTO v_sim_trend_score;

  v_readiness := round(v_mastery_pct * 0.7 + v_sim_trend_score * 0.3, 1);
  v_risk := CASE
    WHEN v_readiness >= 75 THEN 'low'
    WHEN v_readiness >= 50 THEN 'medium'
    ELSE 'high'
  END;

  -- ═══ 3. Find weakest competency (bottleneck) ═══
  SELECT
    ucp.competency_id,
    COALESCE(comp.title, comp.code, 'Unbekannt') as comp_title,
    COALESCE(lf.title, '') as lf_title,
    COALESCE(ucp.score, 0) as score
  INTO v_weakest_comp
  FROM user_competency_progress ucp
  LEFT JOIN competencies comp ON comp.id = ucp.competency_id
  LEFT JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE ucp.user_id = p_user_id
    AND ucp.curriculum_id = p_curriculum_id
    AND ucp.mastery_level IN ('not_mastered', 'partial')
  ORDER BY ucp.score ASC NULLS FIRST
  LIMIT 1;

  -- ═══ 4. Check exam date proximity ═══
  SELECT exam_date INTO v_exam_date
  FROM learner_diagnostics
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;

  IF v_exam_date IS NOT NULL THEN
    v_days_until_exam := v_exam_date - CURRENT_DATE;
  END IF;

  -- ═══ 5. Critical competency gate ═══
  -- Even at high readiness, block if ANY critical competency is below 50%
  SELECT
    ucp.competency_id,
    COALESCE(comp.title, comp.code, 'Unbekannt') as comp_title,
    COALESCE(lf.title, '') as lf_title,
    COALESCE(ucp.score, 0) as score
  INTO v_critical_block
  FROM user_competency_progress ucp
  JOIN competencies comp ON comp.id = ucp.competency_id
  LEFT JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE ucp.user_id = p_user_id
    AND ucp.curriculum_id = p_curriculum_id
    AND COALESCE(ucp.score, 0) < 50
    AND ucp.mastery_level = 'not_mastered'
  ORDER BY COALESCE(ucp.score, 0) ASC
  LIMIT 1;

  -- ═══ 6. Spaced repetition check ═══
  SELECT COUNT(*) INTO v_due_repetitions
  FROM spaced_repetition_items
  WHERE user_id = p_user_id
    AND next_review_at <= NOW()
    AND status = 'active';

  -- ══════════════════════════════════════
  -- DETERMINISTIC STATE MACHINE v2
  -- ══════════════════════════════════════

  -- PRIORITY 1: Crash course (exam imminent + not ready)
  IF v_days_until_exam IS NOT NULL AND v_days_until_exam <= 7 AND v_readiness < 75 THEN
    RETURN jsonb_build_object(
      'action', 'CRASH_COURSE',
      'headline', 'Prüfung in ' || v_days_until_exam || ' Tagen',
      'subline', 'Konzentrier dich jetzt auf deine ' || v_weak || ' schwachen Kompetenzen.',
      'cta', 'Crash-Training starten',
      'route', '/exam-trainer',
      'readiness_score', v_readiness,
      'risk_level', v_risk,
      'bottleneck', CASE WHEN v_weakest_comp IS NOT NULL THEN
        jsonb_build_object('id', v_weakest_comp.competency_id, 'title', v_weakest_comp.comp_title, 'field', v_weakest_comp.lf_title, 'score', v_weakest_comp.score)
      ELSE null::jsonb END,
      'intent', 'weakness_training',
      'route_payload', jsonb_build_object(
        'intent', 'crash_course',
        'competency_id', CASE WHEN v_weakest_comp IS NOT NULL THEN v_weakest_comp.competency_id ELSE null END,
        'curriculum_id', p_curriculum_id
      )
    );
  END IF;

  -- PRIORITY 2: Spaced repetition due (>= 5 items)
  IF v_due_repetitions >= 5 THEN
    RETURN jsonb_build_object(
      'action', 'SPACED_REPETITION',
      'headline', v_due_repetitions || ' Wiederholungen fällig',
      'subline', 'Sichere dein Wissen – diese Fragen solltest du jetzt wiederholen.',
      'cta', 'Wiederholung starten',
      'route', '/spaced-repetition',
      'readiness_score', v_readiness,
      'risk_level', v_risk,
      'bottleneck', CASE WHEN v_weakest_comp IS NOT NULL THEN
        jsonb_build_object('id', v_weakest_comp.competency_id, 'title', v_weakest_comp.comp_title, 'field', v_weakest_comp.lf_title, 'score', v_weakest_comp.score)
      ELSE null::jsonb END,
      'intent', 'spaced_repetition',
      'route_payload', jsonb_build_object(
        'intent', 'spaced_repetition',
        'due_count', v_due_repetitions,
        'curriculum_id', p_curriculum_id
      )
    );
  END IF;

  -- PRIORITY 3: High risk → Weakness Training (with competency_id)
  IF v_risk = 'high' AND v_weakest_comp IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action', 'WEAKNESS_TRAINING',
      'headline', 'Du bist noch nicht prüfungsreif',
      'subline', 'Dein Engpass: ' || v_weakest_comp.comp_title || ' (' || v_weakest_comp.score || '%). Trainiere das gezielt.',
      'cta', 'Schwäche trainieren',
      'route', '/exam-trainer',
      'readiness_score', v_readiness,
      'risk_level', v_risk,
      'bottleneck', jsonb_build_object('id', v_weakest_comp.competency_id, 'title', v_weakest_comp.comp_title, 'field', v_weakest_comp.lf_title, 'score', v_weakest_comp.score),
      'intent', 'weakness_training',
      'route_payload', jsonb_build_object(
        'intent', 'weakness_training',
        'competency_id', v_weakest_comp.competency_id,
        'curriculum_id', p_curriculum_id
      )
    );
  END IF;

  -- PRIORITY 4: Critical competency gate (blocks even "low risk" users)
  IF v_critical_block IS NOT NULL AND v_risk IN ('low', 'medium') THEN
    RETURN jsonb_build_object(
      'action', 'WEAKNESS_TRAINING',
      'headline', 'Kritische Lücke: ' || v_critical_block.comp_title,
      'subline', 'Diese Kompetenz liegt bei nur ' || v_critical_block.score || '%. Ohne sie bestehst du nicht.',
      'cta', 'Lücke schließen',
      'route', '/exam-trainer',
      'readiness_score', v_readiness,
      'risk_level', 'medium',
      'bottleneck', jsonb_build_object('id', v_critical_block.competency_id, 'title', v_critical_block.comp_title, 'field', v_critical_block.lf_title, 'score', v_critical_block.score),
      'intent', 'weakness_training',
      'route_payload', jsonb_build_object(
        'intent', 'critical_competency',
        'competency_id', v_critical_block.competency_id,
        'curriculum_id', p_curriculum_id
      )
    );
  END IF;

  -- PRIORITY 5: Medium risk → Simulation
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
      ELSE null::jsonb END,
      'intent', 'exam_simulation',
      'route_payload', jsonb_build_object(
        'intent', 'exam_simulation',
        'curriculum_id', p_curriculum_id
      )
    );
  END IF;

  -- PRIORITY 6: Low risk → Final exam
  RETURN jsonb_build_object(
    'action', 'EXAM_FINAL',
    'headline', 'Du bist prüfungsreif! (' || round(v_readiness) || '%)',
    'subline', 'Simuliere jetzt die Abschlussprüfung unter echten Bedingungen.',
    'cta', 'Abschlussprüfung starten',
    'route', '/exam-simulation',
    'readiness_score', v_readiness,
    'risk_level', v_risk,
    'bottleneck', null::jsonb,
    'intent', 'exam_final',
    'route_payload', jsonb_build_object(
      'intent', 'exam_final',
      'curriculum_id', p_curriculum_id
    )
  );
END;
$$;

-- ══════════════════════════════════════════════════════
-- Dashboard summary RPC – eliminates N+1
-- ══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_dashboard_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_enrollments jsonb;
  v_active_curriculum_id uuid;
BEGIN
  -- Single query: enrollments + course info + progress counts
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'course_id', e.course_id,
        'enrolled_at', e.enrolled_at,
        'last_accessed_at', e.last_accessed_at,
        'completed_at', e.completed_at,
        'curriculum_id', c.curriculum_id,
        'title', c.title,
        'description', c.description,
        'thumbnail_url', c.thumbnail_url,
        'estimated_duration', c.estimated_duration,
        'total_lessons', COALESCE(lc.cnt, 0),
        'completed_lessons', COALESCE(pc.cnt, 0)
      ) ORDER BY e.last_accessed_at DESC NULLS LAST
    )
  INTO v_enrollments
  FROM course_enrollments e
  JOIN courses c ON c.id = e.course_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) as cnt
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    WHERE m.course_id = e.course_id
  ) lc ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) as cnt
    FROM learning_progress lp
    JOIN lessons l ON l.id = lp.lesson_id
    JOIN modules m ON m.id = l.module_id
    WHERE m.course_id = e.course_id
      AND lp.user_id = p_user_id
      AND lp.completed = true
  ) pc ON true
  WHERE e.user_id = p_user_id;

  -- Derive active curriculum from most recent enrollment
  SELECT c.curriculum_id INTO v_active_curriculum_id
  FROM course_enrollments e
  JOIN courses c ON c.id = e.course_id
  WHERE e.user_id = p_user_id
    AND c.curriculum_id IS NOT NULL
  ORDER BY e.last_accessed_at DESC NULLS LAST
  LIMIT 1;

  RETURN jsonb_build_object(
    'enrollments', COALESCE(v_enrollments, '[]'::jsonb),
    'active_curriculum_id', v_active_curriculum_id
  );
END;
$$;
