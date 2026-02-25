
-- 1) Fix get_lesson_minichecks: remove is_correct from output (security)
CREATE OR REPLACE FUNCTION public.get_lesson_minichecks(p_lesson_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', mq.id,
      'text', mq.question_text,
      'options', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', (idx - 1),
            'text', elem->>'text'
          )
          ORDER BY idx
        )
        FROM jsonb_array_elements(mq.options) WITH ORDINALITY AS t(elem, idx)
      ),
      'explanation_correct', mq.explanation,
      'explanation_wrong', mq.explanation,
      'difficulty', mq.difficulty,
      'cognitive_level', mq.cognitive_level
    )
    ORDER BY mq.sort_order NULLS LAST, mq.created_at
  )
  INTO v_result
  FROM public.minicheck_questions mq
  WHERE mq.lesson_id = p_lesson_id
    AND mq.mode = 'lesson'
    AND mq.status IN ('approved', 'draft');

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- 2) Fix submit_minicheck_attempt: add index validation + lesson guard
CREATE OR REPLACE FUNCTION public.submit_minicheck_attempt(
  p_question_id uuid,
  p_chosen_index integer,
  p_session_id uuid DEFAULT NULL,
  p_lesson_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_correct_answer integer;
  v_is_correct boolean;
  v_user_id uuid := auth.uid();
  v_explanation text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- Validate chosen index range
  IF p_chosen_index < 0 OR p_chosen_index > 3 THEN
    RAISE EXCEPTION 'INVALID_CHOSEN_INDEX';
  END IF;

  -- Lesson consistency guard
  IF p_lesson_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.minicheck_questions
      WHERE id = p_question_id AND lesson_id = p_lesson_id
    ) THEN
      RAISE EXCEPTION 'QUESTION_LESSON_MISMATCH';
    END IF;
  END IF;

  -- Get correct answer + explanation
  SELECT correct_answer, explanation
  INTO v_correct_answer, v_explanation
  FROM public.minicheck_questions
  WHERE id = p_question_id;

  IF v_correct_answer IS NULL THEN
    RAISE EXCEPTION 'QUESTION_NOT_FOUND';
  END IF;

  v_is_correct := (p_chosen_index = v_correct_answer);

  -- Insert attempt
  INSERT INTO public.minicheck_attempts (user_id, minicheck_question_id, lesson_id, session_id, chosen_index, is_correct)
  VALUES (v_user_id, p_question_id, p_lesson_id, p_session_id, p_chosen_index, v_is_correct);

  -- Return result with correct_index + explanation (only AFTER answer submitted)
  RETURN jsonb_build_object(
    'is_correct', v_is_correct,
    'correct_index', v_correct_answer,
    'explanation', COALESCE(v_explanation, '')
  );
END;
$$;

-- 3) Drill RPC: get_drill_minichecks
CREATE OR REPLACE FUNCTION public.get_drill_minichecks(
  p_curriculum_id uuid,
  p_competency_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(q ORDER BY random())
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', mq.id,
      'text', mq.question_text,
      'options', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', (idx - 1),
            'text', elem->>'text'
          )
          ORDER BY idx
        )
        FROM jsonb_array_elements(mq.options) WITH ORDINALITY AS t(elem, idx)
      ),
      'difficulty', mq.difficulty,
      'cognitive_level', mq.cognitive_level,
      'competency_id', mq.competency_id
    ) AS q
    FROM public.minicheck_questions mq
    WHERE mq.curriculum_id = p_curriculum_id
      AND mq.mode = 'drill'
      AND mq.status IN ('approved', 'draft')
      AND (p_competency_id IS NULL OR mq.competency_id = p_competency_id)
    ORDER BY random()
    LIMIT p_limit
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
