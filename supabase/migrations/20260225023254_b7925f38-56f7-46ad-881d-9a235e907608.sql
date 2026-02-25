
-- 1) minicheck_attempts table for persistent attempt tracking
CREATE TABLE public.minicheck_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  minicheck_question_id uuid NOT NULL REFERENCES public.minicheck_questions(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE SET NULL,
  session_id uuid,
  chosen_index integer NOT NULL,
  is_correct boolean NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_minicheck_attempts_user ON public.minicheck_attempts(user_id);
CREATE INDEX idx_minicheck_attempts_question ON public.minicheck_attempts(minicheck_question_id);
CREATE INDEX idx_minicheck_attempts_lesson ON public.minicheck_attempts(lesson_id, user_id);

ALTER TABLE public.minicheck_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own attempts"
  ON public.minicheck_attempts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own attempts"
  ON public.minicheck_attempts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 2) RPC: get_lesson_minichecks — returns approved MiniChecks for a lesson, transformed for UI
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
            'id', mq.id || '-' || idx,
            'text', elem->>'text',
            'is_correct', (idx - 1) = mq.correct_answer
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

-- 3) RPC: submit_minicheck_attempt — writes attempt + returns updated stats
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- Get correct answer
  SELECT correct_answer INTO v_correct_answer
  FROM public.minicheck_questions
  WHERE id = p_question_id;

  IF v_correct_answer IS NULL THEN
    RAISE EXCEPTION 'QUESTION_NOT_FOUND';
  END IF;

  v_is_correct := (p_chosen_index = v_correct_answer);

  -- Insert attempt
  INSERT INTO public.minicheck_attempts (user_id, minicheck_question_id, lesson_id, session_id, chosen_index, is_correct)
  VALUES (v_user_id, p_question_id, p_lesson_id, p_session_id, p_chosen_index, v_is_correct);

  RETURN jsonb_build_object('is_correct', v_is_correct);
END;
$$;
