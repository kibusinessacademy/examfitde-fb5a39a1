-- P0.1 + P0.2: Lernziel-Feedback & Persistenter Lernfortschritt

-- 1) lesson_outcomes: Lernziel-Status pro User/Lesson
CREATE TABLE IF NOT EXISTS public.lesson_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  competency_id uuid REFERENCES public.competencies(id) ON DELETE SET NULL,
  
  -- Status basierend auf Minicheck Score
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'not_mastered', 'partial', 'mastered')),
  
  -- Score-Details
  score_percent integer CHECK (score_percent >= 0 AND score_percent <= 100),
  attempts integer NOT NULL DEFAULT 0,
  
  -- Wiederholungs-Flag
  needs_review boolean NOT NULL DEFAULT false,
  
  -- Timestamps
  started_at timestamptz,
  completed_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Unique constraint: one outcome per user/lesson
  UNIQUE(user_id, lesson_id)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_lesson_outcomes_user ON public.lesson_outcomes(user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_outcomes_lesson ON public.lesson_outcomes(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_outcomes_competency ON public.lesson_outcomes(competency_id);
CREATE INDEX IF NOT EXISTS idx_lesson_outcomes_status ON public.lesson_outcomes(status);
CREATE INDEX IF NOT EXISTS idx_lesson_outcomes_needs_review ON public.lesson_outcomes(needs_review) WHERE needs_review = true;

-- RLS
ALTER TABLE public.lesson_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own outcomes"
ON public.lesson_outcomes FOR ALL
USING (user_id = auth.uid());

CREATE POLICY "Admins can view all outcomes"
ON public.lesson_outcomes FOR SELECT
USING (has_role(auth.uid(), 'admin'));

-- 2) Function: Update lesson outcome after minicheck completion
CREATE OR REPLACE FUNCTION public.update_lesson_outcome(
  p_lesson_id uuid,
  p_score_percent integer
)
RETURNS public.lesson_outcomes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_competency_id uuid;
  v_status text;
  v_needs_review boolean;
  v_result public.lesson_outcomes;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get competency from lesson
  SELECT l.competency_id INTO v_competency_id
  FROM public.lessons l
  WHERE l.id = p_lesson_id;

  -- Calculate status based on score thresholds
  IF p_score_percent >= 80 THEN
    v_status := 'mastered';
    v_needs_review := false;
  ELSIF p_score_percent >= 50 THEN
    v_status := 'partial';
    v_needs_review := true;
  ELSE
    v_status := 'not_mastered';
    v_needs_review := true;
  END IF;

  -- Upsert outcome
  INSERT INTO public.lesson_outcomes (
    user_id, lesson_id, competency_id,
    status, score_percent, attempts,
    needs_review, started_at, completed_at, last_attempt_at, updated_at
  )
  VALUES (
    v_user_id, p_lesson_id, v_competency_id,
    v_status, p_score_percent, 1,
    v_needs_review, now(), now(), now(), now()
  )
  ON CONFLICT (user_id, lesson_id) DO UPDATE SET
    status = v_status,
    score_percent = GREATEST(lesson_outcomes.score_percent, p_score_percent), -- Keep best score
    attempts = lesson_outcomes.attempts + 1,
    needs_review = v_needs_review,
    completed_at = now(),
    last_attempt_at = now(),
    updated_at = now()
  RETURNING * INTO v_result;

  -- Also update learning_progress for backward compatibility
  INSERT INTO public.learning_progress (
    user_id, lesson_id, completed, score, completed_at, updated_at
  )
  VALUES (
    v_user_id, p_lesson_id, true, p_score_percent, now(), now()
  )
  ON CONFLICT (user_id, lesson_id) DO UPDATE SET
    completed = true,
    score = GREATEST(learning_progress.score, p_score_percent),
    completed_at = COALESCE(learning_progress.completed_at, now()),
    updated_at = now();

  RETURN v_result;
END;
$$;

-- 3) Function: Mark lesson as started
CREATE OR REPLACE FUNCTION public.start_lesson(p_lesson_id uuid)
RETURNS public.lesson_outcomes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_competency_id uuid;
  v_result public.lesson_outcomes;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT l.competency_id INTO v_competency_id
  FROM public.lessons l
  WHERE l.id = p_lesson_id;

  INSERT INTO public.lesson_outcomes (
    user_id, lesson_id, competency_id, status, started_at, updated_at
  )
  VALUES (
    v_user_id, p_lesson_id, v_competency_id, 'in_progress', now(), now()
  )
  ON CONFLICT (user_id, lesson_id) DO UPDATE SET
    status = CASE 
      WHEN lesson_outcomes.status = 'not_started' THEN 'in_progress'
      ELSE lesson_outcomes.status
    END,
    started_at = COALESCE(lesson_outcomes.started_at, now()),
    updated_at = now()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- 4) View: Course progress aggregation for user
CREATE OR REPLACE FUNCTION public.get_course_progress(p_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_result jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  WITH lesson_stats AS (
    SELECT
      l.id as lesson_id,
      l.title as lesson_title,
      l.module_id,
      m.title as module_title,
      m.sort_order as module_order,
      l.sort_order as lesson_order,
      c.code as competency_code,
      c.title as competency_title,
      COALESCE(lo.status, 'not_started') as status,
      lo.score_percent,
      lo.needs_review,
      lo.attempts,
      lo.last_attempt_at,
      (l.step_5_minicheck IS NOT NULL) as has_minicheck
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    LEFT JOIN public.competencies c ON c.id = l.competency_id
    LEFT JOIN public.lesson_outcomes lo ON lo.lesson_id = l.id AND lo.user_id = v_user_id
    WHERE m.course_id = p_course_id
  ),
  summary AS (
    SELECT
      COUNT(*) as total_lessons,
      COUNT(*) FILTER (WHERE status = 'mastered') as mastered,
      COUNT(*) FILTER (WHERE status = 'partial') as partial,
      COUNT(*) FILTER (WHERE status = 'not_mastered') as not_mastered,
      COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
      COUNT(*) FILTER (WHERE status = 'not_started') as not_started,
      COUNT(*) FILTER (WHERE needs_review = true) as needs_review,
      COUNT(*) FILTER (WHERE has_minicheck) as with_minicheck,
      AVG(score_percent) FILTER (WHERE score_percent IS NOT NULL) as avg_score
    FROM lesson_stats
  ),
  last_activity AS (
    SELECT lesson_id, lesson_title, module_title, last_attempt_at, status
    FROM lesson_stats
    WHERE status != 'not_started'
    ORDER BY last_attempt_at DESC NULLS LAST
    LIMIT 1
  ),
  next_lesson AS (
    SELECT lesson_id, lesson_title, module_title, module_order, lesson_order
    FROM lesson_stats
    WHERE status IN ('not_started', 'in_progress', 'not_mastered')
    ORDER BY 
      CASE WHEN status = 'in_progress' THEN 0 ELSE 1 END,
      module_order, lesson_order
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'course_id', p_course_id,
    'user_id', v_user_id,
    'summary', (SELECT to_jsonb(summary) FROM summary),
    'progress_percent', (
      SELECT ROUND(
        (COUNT(*) FILTER (WHERE status IN ('mastered', 'partial'))::numeric / 
         NULLIF(COUNT(*)::numeric, 0)) * 100
      )
      FROM lesson_stats
    ),
    'last_activity', (SELECT to_jsonb(last_activity) FROM last_activity),
    'next_lesson', (SELECT to_jsonb(next_lesson) FROM next_lesson),
    'lessons', (
      SELECT jsonb_agg(to_jsonb(lesson_stats) ORDER BY module_order, lesson_order)
      FROM lesson_stats
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 5) Function: Get lessons needing review
CREATE OR REPLACE FUNCTION public.get_lessons_needing_review(p_course_id uuid DEFAULT NULL)
RETURNS TABLE (
  lesson_id uuid,
  lesson_title text,
  module_title text,
  competency_title text,
  score_percent integer,
  attempts integer,
  last_attempt_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id as lesson_id,
    l.title as lesson_title,
    m.title as module_title,
    c.title as competency_title,
    lo.score_percent,
    lo.attempts,
    lo.last_attempt_at
  FROM public.lesson_outcomes lo
  JOIN public.lessons l ON l.id = lo.lesson_id
  JOIN public.modules m ON m.id = l.module_id
  LEFT JOIN public.competencies c ON c.id = lo.competency_id
  WHERE lo.user_id = auth.uid()
    AND lo.needs_review = true
    AND (p_course_id IS NULL OR m.course_id = p_course_id)
  ORDER BY lo.score_percent ASC, lo.last_attempt_at ASC;
$$;