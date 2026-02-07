-- Create RPC function to get user dashboard stats
CREATE OR REPLACE FUNCTION public.get_user_dashboard_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_courses_completed INTEGER;
  v_questions_answered INTEGER;
  v_correct_answers INTEGER;
  v_success_rate NUMERIC;
  v_streak INTEGER;
  v_last_activity DATE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object(
      'courses_completed', 0,
      'questions_answered', 0,
      'success_rate', 0,
      'streak', 0
    );
  END IF;

  -- Count completed courses (enrollments with completed_at set)
  SELECT COUNT(*) INTO v_courses_completed
  FROM course_enrollments
  WHERE user_id = v_user_id AND completed_at IS NOT NULL;

  -- Count total questions answered from exam sessions
  SELECT 
    COALESCE(SUM(CASE WHEN esq.user_answer IS NOT NULL THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN esq.is_correct = true THEN 1 ELSE 0 END), 0)
  INTO v_questions_answered, v_correct_answers
  FROM exam_session_questions esq
  JOIN exam_sessions es ON es.id = esq.exam_session_id
  WHERE es.user_id = v_user_id;

  -- Calculate success rate
  IF v_questions_answered > 0 THEN
    v_success_rate := ROUND((v_correct_answers::NUMERIC / v_questions_answered::NUMERIC) * 100);
  ELSE
    v_success_rate := 0;
  END IF;

  -- Calculate streak (consecutive days with activity)
  WITH activity_days AS (
    SELECT DISTINCT DATE(started_at) as activity_date
    FROM exam_sessions
    WHERE user_id = v_user_id
    UNION
    SELECT DISTINCT DATE(started_at)
    FROM lesson_outcomes
    WHERE user_id = v_user_id AND started_at IS NOT NULL
    ORDER BY activity_date DESC
  ),
  streak_calc AS (
    SELECT 
      activity_date,
      activity_date - (ROW_NUMBER() OVER (ORDER BY activity_date DESC))::INTEGER AS streak_group
    FROM activity_days
    WHERE activity_date >= CURRENT_DATE - INTERVAL '365 days'
  )
  SELECT COUNT(*) INTO v_streak
  FROM streak_calc
  WHERE streak_group = (
    SELECT streak_group FROM streak_calc WHERE activity_date = CURRENT_DATE
    LIMIT 1
  );

  -- If no activity today, check if yesterday continues the streak
  IF v_streak = 0 THEN
    WITH activity_days AS (
      SELECT DISTINCT DATE(started_at) as activity_date
      FROM exam_sessions
      WHERE user_id = v_user_id
      UNION
      SELECT DISTINCT DATE(started_at)
      FROM lesson_outcomes
      WHERE user_id = v_user_id AND started_at IS NOT NULL
      ORDER BY activity_date DESC
    ),
    streak_calc AS (
      SELECT 
        activity_date,
        activity_date - (ROW_NUMBER() OVER (ORDER BY activity_date DESC))::INTEGER AS streak_group
      FROM activity_days
      WHERE activity_date >= CURRENT_DATE - INTERVAL '365 days'
    )
    SELECT COUNT(*) INTO v_streak
    FROM streak_calc
    WHERE streak_group = (
      SELECT streak_group FROM streak_calc WHERE activity_date = CURRENT_DATE - 1
      LIMIT 1
    );
  END IF;

  RETURN json_build_object(
    'courses_completed', COALESCE(v_courses_completed, 0),
    'questions_answered', COALESCE(v_questions_answered, 0),
    'success_rate', COALESCE(v_success_rate, 0),
    'streak', COALESCE(v_streak, 0)
  );
END;
$$;