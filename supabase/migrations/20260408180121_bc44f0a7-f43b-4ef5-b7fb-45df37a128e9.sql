-- Daily Challenge Tables
CREATE TABLE IF NOT EXISTS public.daily_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  challenge_date date NOT NULL DEFAULT CURRENT_DATE,
  question_ids uuid[] NOT NULL DEFAULT '{}',
  answers jsonb NOT NULL DEFAULT '[]',
  total_questions int NOT NULL DEFAULT 5,
  correct_count int NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, curriculum_id, challenge_date)
);

CREATE TABLE IF NOT EXISTS public.user_streaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  current_streak int NOT NULL DEFAULT 0,
  longest_streak int NOT NULL DEFAULT 0,
  last_completed_date date,
  total_challenges_completed int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, curriculum_id)
);

ALTER TABLE public.daily_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own challenges" ON public.daily_challenges FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own challenges" ON public.daily_challenges FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own challenges" ON public.daily_challenges FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users see own streaks" ON public.user_streaks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own streaks" ON public.user_streaks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own streaks" ON public.user_streaks FOR UPDATE USING (auth.uid() = user_id);

-- RPC: Get or create today's daily challenge
CREATE OR REPLACE FUNCTION public.get_daily_challenge(
  p_user_id uuid,
  p_curriculum_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge daily_challenges;
  v_questions jsonb;
  v_question_ids uuid[];
  v_streak user_streaks;
  v_today date := CURRENT_DATE;
BEGIN
  -- Check if today's challenge already exists
  SELECT * INTO v_challenge
  FROM daily_challenges
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id AND challenge_date = v_today;

  IF v_challenge.id IS NOT NULL THEN
    -- Return existing challenge with questions
    SELECT jsonb_agg(jsonb_build_object(
      'id', eq.id,
      'question_text', eq.question_text,
      'question_type', eq.question_type,
      'options', eq.options,
      'difficulty', eq.difficulty,
      'competency_id', eq.competency_id
    ))
    INTO v_questions
    FROM exam_questions eq
    WHERE eq.id = ANY(v_challenge.question_ids);

    -- Get streak
    SELECT * INTO v_streak FROM user_streaks
    WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;

    RETURN jsonb_build_object(
      'challenge_id', v_challenge.id,
      'challenge_date', v_today,
      'questions', COALESCE(v_questions, '[]'::jsonb),
      'answers', v_challenge.answers,
      'completed', v_challenge.completed,
      'correct_count', v_challenge.correct_count,
      'total_questions', v_challenge.total_questions,
      'streak', jsonb_build_object(
        'current', COALESCE(v_streak.current_streak, 0),
        'longest', COALESCE(v_streak.longest_streak, 0),
        'total_completed', COALESCE(v_streak.total_challenges_completed, 0)
      )
    );
  END IF;

  -- Create new challenge: select 5 weighted questions
  -- Priority: weak competencies > blueprint relevance > variety
  SELECT array_agg(q.id) INTO v_question_ids
  FROM (
    SELECT eq.id,
      -- Weakness weight
      CASE 
        WHEN ucp.mastery_level = 'not_mastered' THEN 0
        WHEN ucp.mastery_level = 'partial' THEN 1
        WHEN ucp.mastery_level = 'mastered' THEN 3
        ELSE 2
      END AS weakness_rank,
      -- Variety: different competencies
      ROW_NUMBER() OVER (PARTITION BY eq.competency_id ORDER BY RANDOM()) AS comp_rank
    FROM exam_questions eq
    LEFT JOIN user_competency_progress ucp 
      ON ucp.competency_id = eq.competency_id AND ucp.user_id = p_user_id
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.qc_status IN ('approved', 'tier1_passed')
      -- Exclude questions from yesterday's challenge if exists
      AND eq.id NOT IN (
        SELECT UNNEST(dc.question_ids)
        FROM daily_challenges dc
        WHERE dc.user_id = p_user_id 
          AND dc.curriculum_id = p_curriculum_id
          AND dc.challenge_date = v_today - 1
      )
    ORDER BY weakness_rank ASC, comp_rank ASC, RANDOM()
    LIMIT 5
  ) q;

  IF v_question_ids IS NULL OR array_length(v_question_ids, 1) < 3 THEN
    RETURN jsonb_build_object('error', 'NOT_ENOUGH_QUESTIONS', 'available', COALESCE(array_length(v_question_ids, 1), 0));
  END IF;

  -- Insert challenge
  INSERT INTO daily_challenges (user_id, curriculum_id, challenge_date, question_ids, total_questions)
  VALUES (p_user_id, p_curriculum_id, v_today, v_question_ids, array_length(v_question_ids, 1))
  RETURNING * INTO v_challenge;

  -- Fetch questions
  SELECT jsonb_agg(jsonb_build_object(
    'id', eq.id,
    'question_text', eq.question_text,
    'question_type', eq.question_type,
    'options', eq.options,
    'difficulty', eq.difficulty,
    'competency_id', eq.competency_id
  ))
  INTO v_questions
  FROM exam_questions eq
  WHERE eq.id = ANY(v_question_ids);

  -- Get or create streak
  INSERT INTO user_streaks (user_id, curriculum_id)
  VALUES (p_user_id, p_curriculum_id)
  ON CONFLICT (user_id, curriculum_id) DO NOTHING;

  SELECT * INTO v_streak FROM user_streaks
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;

  RETURN jsonb_build_object(
    'challenge_id', v_challenge.id,
    'challenge_date', v_today,
    'questions', COALESCE(v_questions, '[]'::jsonb),
    'answers', '[]'::jsonb,
    'completed', false,
    'correct_count', 0,
    'total_questions', v_challenge.total_questions,
    'streak', jsonb_build_object(
      'current', COALESCE(v_streak.current_streak, 0),
      'longest', COALESCE(v_streak.longest_streak, 0),
      'total_completed', COALESCE(v_streak.total_challenges_completed, 0)
    )
  );
END;
$$;

-- RPC: Submit answer for daily challenge
CREATE OR REPLACE FUNCTION public.submit_daily_challenge_answer(
  p_user_id uuid,
  p_challenge_id uuid,
  p_question_id uuid,
  p_selected_index int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge daily_challenges;
  v_question exam_questions;
  v_is_correct boolean;
  v_answers jsonb;
  v_correct_count int;
  v_now_completed boolean;
BEGIN
  -- Get challenge
  SELECT * INTO v_challenge FROM daily_challenges
  WHERE id = p_challenge_id AND user_id = p_user_id;

  IF v_challenge.id IS NULL THEN
    RETURN jsonb_build_object('error', 'CHALLENGE_NOT_FOUND');
  END IF;

  IF v_challenge.completed THEN
    RETURN jsonb_build_object('error', 'ALREADY_COMPLETED');
  END IF;

  -- Check question belongs to challenge
  IF NOT (p_question_id = ANY(v_challenge.question_ids)) THEN
    RETURN jsonb_build_object('error', 'QUESTION_NOT_IN_CHALLENGE');
  END IF;

  -- Check not already answered
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_challenge.answers) a
    WHERE (a->>'question_id')::uuid = p_question_id
  ) THEN
    RETURN jsonb_build_object('error', 'ALREADY_ANSWERED');
  END IF;

  -- Get question and check answer
  SELECT * INTO v_question FROM exam_questions WHERE id = p_question_id;
  IF v_question.id IS NULL THEN
    RETURN jsonb_build_object('error', 'QUESTION_NOT_FOUND');
  END IF;

  v_is_correct := (v_question.correct_answer = p_selected_index);

  -- Append answer
  v_answers := v_challenge.answers || jsonb_build_array(jsonb_build_object(
    'question_id', p_question_id,
    'selected_index', p_selected_index,
    'correct_index', v_question.correct_answer,
    'is_correct', v_is_correct,
    'answered_at', now()
  ));

  v_correct_count := (SELECT count(*) FROM jsonb_array_elements(v_answers) a WHERE (a->>'is_correct')::boolean);
  v_now_completed := (jsonb_array_length(v_answers) >= v_challenge.total_questions);

  -- Update challenge
  UPDATE daily_challenges SET
    answers = v_answers,
    correct_count = v_correct_count,
    completed = v_now_completed,
    completed_at = CASE WHEN v_now_completed THEN now() ELSE NULL END
  WHERE id = p_challenge_id;

  -- Update streak if completed
  IF v_now_completed THEN
    UPDATE user_streaks SET
      current_streak = CASE
        WHEN last_completed_date = CURRENT_DATE - 1 THEN current_streak + 1
        WHEN last_completed_date = CURRENT_DATE THEN current_streak
        ELSE 1
      END,
      longest_streak = GREATEST(longest_streak, 
        CASE
          WHEN last_completed_date = CURRENT_DATE - 1 THEN current_streak + 1
          ELSE 1
        END
      ),
      last_completed_date = CURRENT_DATE,
      total_challenges_completed = total_challenges_completed + 1,
      updated_at = now()
    WHERE user_id = p_user_id AND curriculum_id = v_challenge.curriculum_id;

    -- Record learning event
    INSERT INTO learning_events (user_id, event_type, curriculum_id, payload)
    VALUES (p_user_id, 'daily_challenge_completed', v_challenge.curriculum_id, jsonb_build_object(
      'challenge_id', p_challenge_id,
      'correct_count', v_correct_count,
      'total', v_challenge.total_questions
    ));
  END IF;

  RETURN jsonb_build_object(
    'is_correct', v_is_correct,
    'correct_answer', v_question.correct_answer,
    'explanation', COALESCE(v_question.explanation, ''),
    'completed', v_now_completed,
    'correct_count', v_correct_count,
    'answers_given', jsonb_array_length(v_answers),
    'total_questions', v_challenge.total_questions
  );
END;
$$;