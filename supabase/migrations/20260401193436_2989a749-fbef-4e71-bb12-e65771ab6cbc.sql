
-- ============================================================
-- v2.1 HARDENING PATCH
-- ============================================================

-- 1) Recreate get_next_best_action with all 4 fixes
CREATE OR REPLACE FUNCTION public.get_next_best_action(
  p_user_id uuid,
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requesting_uid uuid;
  v_has_competency boolean;
  v_has_lessons boolean;
  v_has_exams boolean;
  v_readiness numeric;
  v_mastery_avg numeric;
  v_sim_trend numeric;
  v_risk text;
  v_days_until_exam integer;
  v_due_count integer;
  v_bottleneck jsonb;
  v_critical_block jsonb;
  v_sim_scores numeric[];
  v_weighted_avg numeric;
BEGIN
  -- ── P0: AUTH GUARD ──────────────────────────────────────
  v_requesting_uid := auth.uid();
  IF v_requesting_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_requesting_uid <> p_user_id THEN
    -- Allow admin override
    IF NOT public.has_role(v_requesting_uid, 'admin') THEN
      RAISE EXCEPTION 'Access denied: cannot query another user''s data';
    END IF;
  END IF;

  -- ── P0: ONBOARDING GATE (3-signal check) ───────────────
  SELECT EXISTS(
    SELECT 1 FROM user_competency_metrics
    WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
    LIMIT 1
  ) INTO v_has_competency;

  SELECT EXISTS(
    SELECT 1 FROM lesson_progress lp
    JOIN lessons l ON l.id = lp.lesson_id
    JOIN modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id
    JOIN curricula cur ON cur.id = c.curriculum_id
    WHERE lp.user_id = p_user_id
      AND cur.id = p_curriculum_id
      AND lp.completed = true
    LIMIT 1
  ) INTO v_has_lessons;

  SELECT EXISTS(
    SELECT 1 FROM exam_sessions es
    WHERE es.user_id = p_user_id
      AND es.curriculum_id = p_curriculum_id
      AND es.status = 'completed'
    LIMIT 1
  ) INTO v_has_exams;

  IF NOT v_has_competency AND NOT v_has_lessons AND NOT v_has_exams THEN
    RETURN jsonb_build_object(
      'action', 'ONBOARDING',
      'headline', 'Willkommen! Lass uns starten.',
      'subline', 'Wir ermitteln deinen aktuellen Stand, damit du gezielt lernen kannst.',
      'cta', 'Einstufung starten',
      'route', '/readiness-check',
      'readiness_score', 0,
      'risk_level', 'high',
      'bottleneck', NULL,
      'intent', 'onboarding',
      'route_payload', jsonb_build_object(
        'intent', 'onboarding',
        'curriculum_id', p_curriculum_id
      )
    );
  END IF;

  -- ── Mastery average ─────────────────────────────────────
  SELECT COALESCE(AVG(
    CASE
      WHEN mastery_level = 'mastered' THEN score
      WHEN mastery_level = 'partial' THEN score * 0.5
      ELSE score * 0.25
    END
  ), 0)
  INTO v_mastery_avg
  FROM user_competency_metrics
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;

  -- ── P2: Clean weighted average (0.5/0.3/0.2) ───────────
  SELECT ARRAY(
    SELECT COALESCE(es.score, 0)
    FROM exam_sessions es
    WHERE es.user_id = p_user_id
      AND es.curriculum_id = p_curriculum_id
      AND es.status = 'completed'
      AND es.score IS NOT NULL
    ORDER BY es.completed_at DESC
    LIMIT 3
  ) INTO v_sim_scores;

  IF array_length(v_sim_scores, 1) >= 3 THEN
    v_weighted_avg := v_sim_scores[1] * 0.5 + v_sim_scores[2] * 0.3 + v_sim_scores[3] * 0.2;
  ELSIF array_length(v_sim_scores, 1) = 2 THEN
    v_weighted_avg := v_sim_scores[1] * 0.6 + v_sim_scores[2] * 0.4;
  ELSIF array_length(v_sim_scores, 1) = 1 THEN
    v_weighted_avg := v_sim_scores[1];
  ELSE
    v_weighted_avg := 0;
  END IF;

  v_sim_trend := v_weighted_avg;

  -- ── Readiness ───────────────────────────────────────────
  v_readiness := 0.7 * v_mastery_avg + 0.3 * v_sim_trend;

  IF v_readiness >= 75 THEN v_risk := 'low';
  ELSIF v_readiness >= 50 THEN v_risk := 'medium';
  ELSE v_risk := 'high';
  END IF;

  -- ── Days until exam ─────────────────────────────────────
  SELECT COALESCE(
    EXTRACT(DAY FROM (MIN(ue.exam_date) - now()))::integer,
    999
  )
  INTO v_days_until_exam
  FROM user_enrollments ue
  JOIN courses c ON c.id = ue.course_id
  WHERE ue.user_id = p_user_id
    AND c.curriculum_id = p_curriculum_id
    AND ue.exam_date IS NOT NULL;

  -- ── Spaced repetition due count ─────────────────────────
  SELECT COUNT(*)::integer
  INTO v_due_count
  FROM spaced_repetition_cards src
  WHERE src.user_id = p_user_id
    AND src.curriculum_id = p_curriculum_id
    AND src.next_review_at <= now();

  -- ── Bottleneck (weakest competency) ─────────────────────
  SELECT jsonb_build_object(
    'id', ucm.competency_id,
    'title', COALESCE(comp.title, 'Unbekannte Kompetenz'),
    'field', COALESCE(lf.title, ''),
    'score', ucm.score
  )
  INTO v_bottleneck
  FROM user_competency_metrics ucm
  LEFT JOIN competencies comp ON comp.id = ucm.competency_id
  LEFT JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE ucm.user_id = p_user_id
    AND ucm.curriculum_id = p_curriculum_id
  ORDER BY ucm.score ASC
  LIMIT 1;

  -- ── CRASH COURSE (exam < 7 days, readiness < 75) ───────
  IF v_days_until_exam <= 7 AND v_readiness < 75 THEN
    RETURN jsonb_build_object(
      'action', 'CRASH_COURSE',
      'headline', format('Nur noch %s Tage – Intensivmodus!', v_days_until_exam),
      'subline', 'Fokus auf die prüfungsrelevantesten Schwächen.',
      'cta', 'Crashkurs starten',
      'route', '/exam-trainer',
      'readiness_score', ROUND(v_readiness),
      'risk_level', v_risk,
      'bottleneck', v_bottleneck,
      'intent', 'crash_course',
      'route_payload', jsonb_build_object(
        'intent', 'crash_course',
        'curriculum_id', p_curriculum_id,
        'competency_id', v_bottleneck->>'id'
      )
    );
  END IF;

  -- ── SPACED REPETITION (>= 5 due) ───────────────────────
  IF v_due_count >= 5 THEN
    RETURN jsonb_build_object(
      'action', 'SPACED_REPETITION',
      'headline', format('%s Wiederholungen fällig', v_due_count),
      'subline', 'Sichere dein Wissen, bevor du weiter lernst.',
      'cta', 'Jetzt wiederholen',
      'route', '/spaced-repetition',
      'readiness_score', ROUND(v_readiness),
      'risk_level', v_risk,
      'bottleneck', v_bottleneck,
      'intent', 'spaced_repetition',
      'route_payload', jsonb_build_object(
        'intent', 'spaced_repetition',
        'curriculum_id', p_curriculum_id,
        'due_count', v_due_count
      )
    );
  END IF;

  -- ── WEAKNESS TRAINING (risk high/medium) ────────────────
  IF v_risk IN ('high', 'medium') THEN
    RETURN jsonb_build_object(
      'action', 'WEAKNESS_TRAINING',
      'headline', 'Gezielt Schwächen abbauen',
      'subline', format('Dein Engpass: %s', COALESCE(v_bottleneck->>'title', 'Unbekannt')),
      'cta', 'Schwäche trainieren',
      'route', '/exam-trainer',
      'readiness_score', ROUND(v_readiness),
      'risk_level', v_risk,
      'bottleneck', v_bottleneck,
      'intent', 'weakness_training',
      'route_payload', jsonb_build_object(
        'intent', 'weakness_training',
        'curriculum_id', p_curriculum_id,
        'competency_id', v_bottleneck->>'id'
      )
    );
  END IF;

  -- ── P1: CRITICAL COMPETENCY GATE ────────────────────────
  -- Check for critical competencies (is_critical flag OR high exam_weight)
  -- that are still below 50%, even when overall readiness is fine.
  SELECT jsonb_build_object(
    'id', ucm.competency_id,
    'title', COALESCE(comp.title, 'Unbekannte Kompetenz'),
    'field', COALESCE(lf.title, ''),
    'score', ucm.score
  )
  INTO v_critical_block
  FROM user_competency_metrics ucm
  JOIN competencies comp ON comp.id = ucm.competency_id
  LEFT JOIN learning_fields lf ON lf.id = comp.learning_field_id
  LEFT JOIN curriculum_competency_weights ccw
    ON ccw.competency_id = comp.id AND ccw.curriculum_id = p_curriculum_id
  WHERE ucm.user_id = p_user_id
    AND ucm.curriculum_id = p_curriculum_id
    AND ucm.score < 50
    AND (
      COALESCE(ccw.is_critical, false) = true
      OR COALESCE(ccw.exam_weight, 0) > 0.15
      OR comp.is_exam_relevant = true
    )
  ORDER BY ucm.score ASC
  LIMIT 1;

  IF v_critical_block IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action', 'WEAKNESS_TRAINING',
      'headline', 'Kritische Lücke schließen',
      'subline', format('%s ist bestehensrelevant und noch zu schwach.', v_critical_block->>'title'),
      'cta', 'Jetzt gezielt trainieren',
      'route', '/exam-trainer',
      'readiness_score', ROUND(v_readiness),
      'risk_level', 'high',
      'bottleneck', v_critical_block,
      'intent', 'critical_competency_gate',
      'route_payload', jsonb_build_object(
        'intent', 'critical_competency_gate',
        'curriculum_id', p_curriculum_id,
        'competency_id', v_critical_block->>'id'
      )
    );
  END IF;

  -- ── EXAM SIMULATION ─────────────────────────────────────
  IF v_readiness < 85 THEN
    RETURN jsonb_build_object(
      'action', 'EXAM_SIMULATION',
      'headline', 'Bereit für eine Simulation',
      'subline', format('Prüfungsreife: %s%% – teste dich unter Realbedingungen.', ROUND(v_readiness)),
      'cta', 'Simulation starten',
      'route', '/exam-simulation',
      'readiness_score', ROUND(v_readiness),
      'risk_level', v_risk,
      'bottleneck', v_bottleneck,
      'intent', 'exam_simulation',
      'route_payload', jsonb_build_object(
        'intent', 'exam_simulation',
        'curriculum_id', p_curriculum_id
      )
    );
  END IF;

  -- ── EXAM FINAL ──────────────────────────────────────────
  RETURN jsonb_build_object(
    'action', 'EXAM_FINAL',
    'headline', 'Du bist prüfungsreif!',
    'subline', format('Prüfungsreife: %s%% – Finale Generalprobe empfohlen.', ROUND(v_readiness)),
    'cta', 'Generalprobe starten',
    'route', '/exam-simulation',
    'readiness_score', ROUND(v_readiness),
    'risk_level', v_risk,
    'bottleneck', v_bottleneck,
    'intent', 'exam_final',
    'route_payload', jsonb_build_object(
      'intent', 'exam_final',
      'curriculum_id', p_curriculum_id
    )
  );
END;
$$;

-- 2) Recreate get_dashboard_summary with auth guard
CREATE OR REPLACE FUNCTION public.get_dashboard_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requesting_uid uuid;
  v_result jsonb;
BEGIN
  -- ── AUTH GUARD ──────────────────────────────────────────
  v_requesting_uid := auth.uid();
  IF v_requesting_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_requesting_uid <> p_user_id THEN
    IF NOT public.has_role(v_requesting_uid, 'admin') THEN
      RAISE EXCEPTION 'Access denied: cannot query another user''s data';
    END IF;
  END IF;

  -- ── Aggregated dashboard data in one query ──────────────
  SELECT jsonb_build_object(
    'enrollments', COALESCE(jsonb_agg(
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
        'total_lessons', COALESCE(lc.total, 0),
        'completed_lessons', COALESCE(lc.done, 0)
      )
    ) FILTER (WHERE e.course_id IS NOT NULL), '[]'::jsonb),
    'active_curriculum_id', (
      SELECT c2.curriculum_id
      FROM user_enrollments e2
      JOIN courses c2 ON c2.id = e2.course_id
      WHERE e2.user_id = p_user_id
        AND e2.completed_at IS NULL
      ORDER BY COALESCE(e2.last_accessed_at, e2.enrolled_at) DESC
      LIMIT 1
    )
  )
  INTO v_result
  FROM user_enrollments e
  JOIN courses c ON c.id = e.course_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::integer AS total,
      COUNT(*) FILTER (WHERE lp.completed = true)::integer AS done
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = p_user_id
    WHERE m.course_id = e.course_id
  ) lc ON true
  WHERE e.user_id = p_user_id;

  RETURN COALESCE(v_result, jsonb_build_object('enrollments', '[]'::jsonb, 'active_curriculum_id', NULL));
END;
$$;
