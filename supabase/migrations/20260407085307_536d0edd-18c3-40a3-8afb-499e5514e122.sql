
-- ============================================
-- GROWTH ENGINE: TABELLEN
-- ============================================

-- 1. Daily Question Picks
CREATE TABLE public.daily_question_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day DATE NOT NULL,
  curriculum_id UUID NOT NULL,
  exam_question_id UUID REFERENCES public.exam_questions(id) ON DELETE SET NULL,
  blueprint_id UUID,
  trap_type TEXT,
  slug TEXT NOT NULL,
  hook TEXT,
  explanation_md TEXT,
  social_captions JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(day, curriculum_id)
);

CREATE INDEX idx_dqp_day ON public.daily_question_picks(day DESC);
CREATE INDEX idx_dqp_slug ON public.daily_question_picks(slug);
CREATE INDEX idx_dqp_curriculum ON public.daily_question_picks(curriculum_id);
CREATE INDEX idx_dqp_status ON public.daily_question_picks(status);

ALTER TABLE public.daily_question_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read for published daily questions"
  ON public.daily_question_picks FOR SELECT
  USING (status = 'published');

CREATE POLICY "Admins manage daily questions"
  ON public.daily_question_picks FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. Trap Content Pages
CREATE TABLE public.trap_content_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id UUID NOT NULL,
  competency_id UUID,
  trap_type TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  hook TEXT,
  content_md TEXT,
  examples_json JSONB DEFAULT '[]',
  social_captions JSONB DEFAULT '{}',
  seo_meta JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tcp_slug ON public.trap_content_pages(slug);
CREATE INDEX idx_tcp_curriculum ON public.trap_content_pages(curriculum_id);
CREATE INDEX idx_tcp_trap_type ON public.trap_content_pages(trap_type);
CREATE INDEX idx_tcp_status ON public.trap_content_pages(status);

ALTER TABLE public.trap_content_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read for published trap content"
  ON public.trap_content_pages FOR SELECT
  USING (status = 'published');

CREATE POLICY "Admins manage trap content"
  ON public.trap_content_pages FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Growth Content Queue (unified)
CREATE TABLE public.growth_content_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,
  source_type TEXT,
  source_id UUID,
  platform TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ,
  content_json JSONB DEFAULT '{}',
  posted_at TIMESTAMPTZ,
  post_url TEXT,
  engagement_json JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gcq_channel ON public.growth_content_queue(channel);
CREATE INDEX idx_gcq_status ON public.growth_content_queue(status);
CREATE INDEX idx_gcq_scheduled ON public.growth_content_queue(scheduled_at);
CREATE INDEX idx_gcq_platform ON public.growth_content_queue(platform);

ALTER TABLE public.growth_content_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage content queue"
  ON public.growth_content_queue FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. Pass Calculator Sessions (Lead Capture)
CREATE TABLE public.pass_calculator_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  email TEXT,
  curriculum_id UUID,
  inputs_json JSONB NOT NULL DEFAULT '{}',
  result_json JSONB DEFAULT '{}',
  pass_probability NUMERIC(5,2),
  recommendation TEXT,
  source TEXT DEFAULT 'web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pcs_curriculum ON public.pass_calculator_sessions(curriculum_id);
CREATE INDEX idx_pcs_email ON public.pass_calculator_sessions(email);

ALTER TABLE public.pass_calculator_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can create calculator sessions"
  ON public.pass_calculator_sessions FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Users can read own sessions"
  ON public.pass_calculator_sessions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins read all calculator sessions"
  ON public.pass_calculator_sessions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- RPC: DAILY QUESTION PICKER
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_pick_daily_question(p_curriculum_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_existing UUID;
  v_question RECORD;
  v_curriculum RECORD;
  v_slug TEXT;
BEGIN
  -- Check if already picked today
  SELECT id INTO v_existing
  FROM daily_question_picks
  WHERE day = v_today AND curriculum_id = p_curriculum_id;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('already_picked', true, 'pick_id', v_existing);
  END IF;

  -- Get curriculum info for slug
  SELECT title, slug INTO v_curriculum
  FROM curricula WHERE id = p_curriculum_id;

  -- Pick best question: approved, has trap, not used in last 90 days
  SELECT eq.id, eq.question_text, eq.explanation, eq.trap_tags,
         eq.blueprint_id, eq.difficulty, eq.competency_id,
         eq.options, eq.correct_answer, eq.cognitive_level
  INTO v_question
  FROM exam_questions eq
  WHERE eq.curriculum_id = p_curriculum_id
    AND eq.status = 'approved'
    AND eq.trap_tags IS NOT NULL
    AND array_length(eq.trap_tags, 1) > 0
    AND eq.id NOT IN (
      SELECT exam_question_id FROM daily_question_picks
      WHERE curriculum_id = p_curriculum_id
        AND exam_question_id IS NOT NULL
        AND day > v_today - INTERVAL '90 days'
    )
  ORDER BY
    -- Prefer questions with interesting traps
    array_length(eq.trap_tags, 1) DESC,
    -- Mix difficulties
    CASE eq.difficulty
      WHEN 'medium' THEN 1
      WHEN 'hard' THEN 2
      WHEN 'easy' THEN 3
      ELSE 4
    END,
    random()
  LIMIT 1;

  IF v_question.id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_eligible_questions');
  END IF;

  -- Generate slug
  v_slug := to_char(v_today, 'YYYY-MM-DD') || '-' || COALESCE(v_curriculum.slug, 'frage');

  -- Insert pick
  INSERT INTO daily_question_picks (day, curriculum_id, exam_question_id, blueprint_id, trap_type, slug, status)
  VALUES (v_today, p_curriculum_id, v_question.id, v_question.blueprint_id,
          v_question.trap_tags[1], v_slug, 'draft')
  RETURNING id INTO v_existing;

  RETURN jsonb_build_object(
    'pick_id', v_existing,
    'question_id', v_question.id,
    'slug', v_slug,
    'trap_type', v_question.trap_tags[1],
    'difficulty', v_question.difficulty
  );
END;
$$;

-- ============================================
-- RPC: PASS PROBABILITY CALCULATOR
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_calculate_pass_probability(
  p_user_id UUID DEFAULT NULL,
  p_curriculum_id UUID DEFAULT NULL,
  p_self_assessment JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_readiness RECORD;
  v_sessions_count INT;
  v_avg_score NUMERIC;
  v_trend TEXT;
  v_probability NUMERIC;
  v_weak_areas JSONB;
  v_recommendation TEXT;
BEGIN
  -- If user is logged in, use real data
  IF p_user_id IS NOT NULL AND p_curriculum_id IS NOT NULL THEN
    SELECT overall_readiness, predicted_exam_score, weak_areas, strong_areas, trend, days_until_ready
    INTO v_readiness
    FROM readiness_scores
    WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
    ORDER BY calculated_at DESC LIMIT 1;

    SELECT COUNT(*), COALESCE(AVG(score_percentage), 0)
    INTO v_sessions_count, v_avg_score
    FROM exam_sessions
    WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
      AND status = 'completed';

    IF v_readiness.overall_readiness IS NOT NULL THEN
      v_probability := LEAST(99, GREATEST(5,
        v_readiness.overall_readiness * 0.4 +
        v_readiness.predicted_exam_score * 0.3 +
        COALESCE(v_avg_score, 50) * 0.2 +
        CASE WHEN v_sessions_count > 5 THEN 10 ELSE v_sessions_count * 2 END
      ));
      v_weak_areas := v_readiness.weak_areas;
      v_trend := v_readiness.trend;
    ELSE
      v_probability := 35 + random() * 15;
      v_weak_areas := '[]'::JSONB;
      v_trend := 'unknown';
    END IF;
  ELSE
    -- Anonymous: Use self-assessment
    v_probability := LEAST(95, GREATEST(10,
      COALESCE((p_self_assessment->>'study_hours_per_week')::NUMERIC * 3, 15) +
      COALESCE((p_self_assessment->>'weeks_until_exam')::NUMERIC * 0.5, 10) +
      COALESCE((p_self_assessment->>'confidence')::NUMERIC * 5, 25) +
      CASE WHEN (p_self_assessment->>'has_practiced')::BOOLEAN THEN 15 ELSE 0 END +
      CASE WHEN (p_self_assessment->>'has_course')::BOOLEAN THEN 10 ELSE 0 END
    ));
    v_weak_areas := '[]'::JSONB;
    v_trend := 'unknown';
  END IF;

  -- Generate recommendation
  v_recommendation := CASE
    WHEN v_probability >= 80 THEN 'Du bist gut vorbereitet! Fokussiere dich auf Prüfungssimulationen zur Festigung.'
    WHEN v_probability >= 60 THEN 'Gute Basis! Arbeite gezielt an deinen Schwachstellen und mache regelmäßig Übungsprüfungen.'
    WHEN v_probability >= 40 THEN 'Du bist auf dem Weg, aber brauchst noch mehr Übung. Starte mit den Grundlagen und arbeite dich hoch.'
    ELSE 'Intensive Vorbereitung empfohlen. ExamFit hilft dir mit einem strukturierten Lernplan.'
  END;

  RETURN jsonb_build_object(
    'pass_probability', round(v_probability, 1),
    'trend', v_trend,
    'weak_areas', v_weak_areas,
    'recommendation', v_recommendation,
    'sessions_completed', COALESCE(v_sessions_count, 0),
    'avg_score', round(COALESCE(v_avg_score, 0), 1),
    'data_quality', CASE
      WHEN p_user_id IS NOT NULL AND v_readiness.overall_readiness IS NOT NULL THEN 'high'
      WHEN p_user_id IS NOT NULL THEN 'medium'
      ELSE 'self_assessment'
    END
  );
END;
$$;

-- ============================================
-- RPC: Growth Engine Admin Overview
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_growth_engine_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'daily_questions', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'published', COUNT(*) FILTER (WHERE status = 'published'),
        'draft', COUNT(*) FILTER (WHERE status = 'draft'),
        'today_picked', EXISTS(SELECT 1 FROM daily_question_picks WHERE day = CURRENT_DATE),
        'curricula_covered', COUNT(DISTINCT curriculum_id)
      ) FROM daily_question_picks
    ),
    'trap_content', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'published', COUNT(*) FILTER (WHERE status = 'published'),
        'draft', COUNT(*) FILTER (WHERE status = 'draft'),
        'trap_types_covered', COUNT(DISTINCT trap_type)
      ) FROM trap_content_pages
    ),
    'content_queue', (
      SELECT jsonb_build_object(
        'pending', COUNT(*) FILTER (WHERE status = 'pending'),
        'scheduled', COUNT(*) FILTER (WHERE status = 'scheduled'),
        'posted', COUNT(*) FILTER (WHERE status = 'posted'),
        'failed', COUNT(*) FILTER (WHERE status = 'failed'),
        'by_channel', (
          SELECT jsonb_object_agg(channel, cnt)
          FROM (SELECT channel, COUNT(*) cnt FROM growth_content_queue GROUP BY channel) sub
        )
      ) FROM growth_content_queue
    ),
    'calculator', (
      SELECT jsonb_build_object(
        'total_sessions', COUNT(*),
        'with_email', COUNT(*) FILTER (WHERE email IS NOT NULL),
        'avg_probability', round(AVG(pass_probability), 1),
        'last_7_days', COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')
      ) FROM pass_calculator_sessions
    ),
    'available_questions', (
      SELECT COUNT(*) FROM exam_questions
      WHERE status = 'approved' AND trap_tags IS NOT NULL AND array_length(trap_tags, 1) > 0
    ),
    'available_trap_types', (
      SELECT COUNT(DISTINCT unnest_val)
      FROM exam_questions, LATERAL unnest(trap_tags) AS unnest_val
      WHERE status = 'approved' AND trap_tags IS NOT NULL
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;
