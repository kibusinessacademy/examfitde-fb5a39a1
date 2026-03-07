
-- ═══════════════════════════════════════════════════════════
-- Phase 2: Adaptive Exam Engine - Mastery-Weighted Selection
-- ═══════════════════════════════════════════════════════════

-- Enhanced pick_next_adaptive_question: combines IRT theta with mastery weakness
CREATE OR REPLACE FUNCTION public.pick_next_adaptive_question(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_curriculum uuid;
  v_theta numeric;
  v_q uuid;
  v_answered_count int;
  v_total_questions int;
BEGIN
  SELECT user_id, curriculum_id, total_questions
    INTO v_user, v_curriculum, v_total_questions
  FROM public.exam_sessions
  WHERE id = p_session_id;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  -- Count already answered
  SELECT count(*) INTO v_answered_count
  FROM public.exam_session_questions
  WHERE exam_session_id = p_session_id;

  -- Stop if we've reached the limit
  IF v_answered_count >= v_total_questions THEN
    RETURN NULL;
  END IF;

  -- Get current theta
  SELECT coalesce(theta_overall, 0)
    INTO v_theta
  FROM public.user_ability_profiles
  WHERE user_id = v_user AND curriculum_id = v_curriculum;

  IF v_theta IS NULL THEN v_theta := 0; END IF;

  -- Mastery-weighted adaptive selection:
  -- 1. Join questions with skill mappings and user mastery
  -- 2. Weight by: low mastery = higher priority, IRT match, discrimination
  -- 3. Guarantee LF coverage (min 1 question per LF before repeating)
  SELECT eq.id INTO v_q
  FROM public.exam_questions eq
  LEFT JOIN public.exam_session_questions esq
    ON esq.exam_session_id = p_session_id AND esq.question_id = eq.id
  LEFT JOIN public.question_skill_map qsm
    ON qsm.question_id = eq.id
  LEFT JOIN public.user_skill_scores uss
    ON uss.user_id = v_user AND uss.skill_node_id = qsm.skill_node_id
  LEFT JOIN public.learning_fields lf
    ON lf.curriculum_id = v_curriculum AND lf.code = eq.learning_field_code
  WHERE eq.curriculum_id = v_curriculum
    AND esq.question_id IS NULL  -- not already in session
    AND eq.status = 'approved'
  ORDER BY
    -- Priority 1: Target weak competencies (low mastery → high weight)
    CASE
      WHEN coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 50) < 40 THEN 0  -- critical weakness
      WHEN coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 50) < 60 THEN 1  -- partial
      WHEN coalesce(uss.decay_adjusted_mastery, uss.mastery_pct, 50) < 80 THEN 2  -- needs review
      ELSE 3  -- mastered → lower priority
    END,
    -- Priority 2: Low confidence skills get more questions
    coalesce(uss.confidence, 0) ASC,
    -- Priority 3: IRT - best discrimination first
    coalesce(eq.item_discrimination, 1.0) DESC,
    -- Priority 4: IRT - closest to theta
    abs(coalesce(eq.item_difficulty, 0) - v_theta) ASC,
    -- Priority 5: LF coverage - prefer underrepresented LFs
    (SELECT count(*) FROM public.exam_session_questions esq2
     JOIN public.exam_questions eq2 ON eq2.id = esq2.question_id
     WHERE esq2.exam_session_id = p_session_id
       AND eq2.learning_field_code = eq.learning_field_code) ASC,
    random()
  LIMIT 1;

  RETURN v_q;
END $$;

-- Mastery-weighted question assembly for simulation mode
-- Returns question IDs optimally selected based on mastery gaps
CREATE OR REPLACE FUNCTION public.assemble_mastery_weighted_exam(
  p_user_id uuid,
  p_curriculum_id uuid,
  p_total_questions int DEFAULT 60,
  p_min_per_lf int DEFAULT 2
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result uuid[] := ARRAY[]::uuid[];
  v_lf record;
  v_lf_count int;
  v_remaining int;
  v_lf_questions uuid[];
BEGIN
  -- Phase 1: Guarantee minimum coverage per learning field
  FOR v_lf IN
    SELECT lf.code, lf.weight_percent
    FROM public.learning_fields lf
    WHERE lf.curriculum_id = p_curriculum_id
    ORDER BY lf.sort_order
  LOOP
    SELECT array_agg(eq.id ORDER BY
      -- Prioritize weak skills
      coalesce(uss.decay_adjusted_mastery, 50) ASC,
      coalesce(uss.confidence, 0) ASC,
      coalesce(eq.item_discrimination, 1) DESC,
      random()
    )
    INTO v_lf_questions
    FROM public.exam_questions eq
    LEFT JOIN public.question_skill_map qsm ON qsm.question_id = eq.id
    LEFT JOIN public.user_skill_scores uss
      ON uss.user_id = p_user_id AND uss.skill_node_id = qsm.skill_node_id
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.status = 'approved'
      AND eq.learning_field_code = v_lf.code
      AND eq.id != ALL(v_result)
    LIMIT p_min_per_lf;

    IF v_lf_questions IS NOT NULL THEN
      v_result := v_result || v_lf_questions;
    END IF;
  END LOOP;

  -- Phase 2: Fill remaining slots with mastery-weighted selection
  v_remaining := p_total_questions - array_length(v_result, 1);
  IF v_remaining IS NULL THEN v_remaining := p_total_questions; END IF;

  IF v_remaining > 0 THEN
    SELECT array_agg(eq.id ORDER BY
      CASE
        WHEN coalesce(uss.decay_adjusted_mastery, 50) < 40 THEN 0
        WHEN coalesce(uss.decay_adjusted_mastery, 50) < 60 THEN 1
        WHEN coalesce(uss.decay_adjusted_mastery, 50) < 80 THEN 2
        ELSE 3
      END,
      coalesce(uss.confidence, 0) ASC,
      coalesce(eq.item_discrimination, 1) DESC,
      random()
    ) INTO v_lf_questions
    FROM public.exam_questions eq
    LEFT JOIN public.question_skill_map qsm ON qsm.question_id = eq.id
    LEFT JOIN public.user_skill_scores uss
      ON uss.user_id = p_user_id AND uss.skill_node_id = qsm.skill_node_id
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.status = 'approved'
      AND eq.id != ALL(v_result)
    LIMIT v_remaining;

    IF v_lf_questions IS NOT NULL THEN
      v_result := v_result || v_lf_questions;
    END IF;
  END IF;

  RETURN v_result;
END $$;
