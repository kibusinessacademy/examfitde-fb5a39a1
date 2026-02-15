
-- ═══════════════════════════════════════════════════════
-- IRT-Light: Item calibration + User ability profiles + Cognitive levels
-- ═══════════════════════════════════════════════════════

-- 1) Add IRT calibration fields to exam_questions
ALTER TABLE public.exam_questions
  ADD COLUMN IF NOT EXISTS item_difficulty real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS item_discrimination real DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS item_guessing real DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS item_usage_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS item_calibrated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cognitive_level text DEFAULT 'understand'
    CHECK (cognitive_level IN ('remember','understand','apply','analyze','evaluate'));

-- 2) Add cognitive_level to question_quality_metrics
ALTER TABLE public.question_quality_metrics
  ADD COLUMN IF NOT EXISTS cognitive_depth_score real DEFAULT 0;

-- 3) User Ability Profiles (IRT theta per dimension)
CREATE TABLE IF NOT EXISTS public.user_ability_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  theta_overall real DEFAULT 0,
  theta_remember real DEFAULT 0,
  theta_understand real DEFAULT 0,
  theta_apply real DEFAULT 0,
  theta_analyze real DEFAULT 0,
  theta_evaluate real DEFAULT 0,
  confidence_adjusted_theta real DEFAULT 0,
  pass_probability real DEFAULT 0,
  total_items_seen integer DEFAULT 0,
  last_session_id uuid,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, curriculum_id)
);

ALTER TABLE public.user_ability_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ability profile"
  ON public.user_ability_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own ability profile"
  ON public.user_ability_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ability profile"
  ON public.user_ability_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 4) Add confidence tracking to exam_session_questions
ALTER TABLE public.exam_session_questions
  ADD COLUMN IF NOT EXISTS user_confidence integer DEFAULT NULL
    CHECK (user_confidence IS NULL OR (user_confidence >= 0 AND user_confidence <= 100));

-- 5) Add cognitive distribution tracking to exam_sessions
ALTER TABLE public.exam_sessions
  ADD COLUMN IF NOT EXISTS cognitive_distribution jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS theta_at_start real,
  ADD COLUMN IF NOT EXISTS theta_at_end real,
  ADD COLUMN IF NOT EXISTS pass_probability_at_end real;

-- 6) Function: Recalibrate item difficulty based on response data
CREATE OR REPLACE FUNCTION public.calibrate_item_difficulty(p_min_responses integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE public.exam_questions eq SET
    item_difficulty = 1.0 - sub.correct_rate,
    item_usage_count = sub.total_responses,
    item_calibrated_at = now()
  FROM (
    SELECT
      qa.question_id,
      count(*)::real AS total_responses,
      avg(CASE WHEN qa.is_correct THEN 1.0 ELSE 0.0 END) AS correct_rate
    FROM public.question_attempts qa
    GROUP BY qa.question_id
    HAVING count(*) >= p_min_responses
  ) sub
  WHERE eq.id = sub.question_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- 7) Function: Calculate user theta (simplified IRT)
CREATE OR REPLACE FUNCTION public.calculate_user_theta(
  p_user_id uuid,
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_theta_overall real := 0;
  v_theta_remember real := 0;
  v_theta_apply real := 0;
  v_theta_analyze real := 0;
  v_conf_adj real := 0;
  v_pass_prob real := 0;
  v_total integer := 0;
  r record;
BEGIN
  -- Calculate weighted theta per cognitive level from recent attempts
  FOR r IN
    SELECT
      eq.cognitive_level,
      avg(CASE WHEN qa.is_correct THEN eq.item_difficulty ELSE -eq.item_difficulty END) AS weighted_score,
      count(*) AS cnt
    FROM public.question_attempts qa
    JOIN public.exam_questions eq ON eq.id = qa.question_id
    WHERE qa.user_id = p_user_id
      AND eq.curriculum_id = p_curriculum_id
      AND qa.answered_at > now() - interval '90 days'
    GROUP BY eq.cognitive_level
  LOOP
    v_total := v_total + r.cnt;
    CASE r.cognitive_level
      WHEN 'remember' THEN v_theta_remember := r.weighted_score;
      WHEN 'understand' THEN v_theta_overall := v_theta_overall + r.weighted_score;
      WHEN 'apply' THEN v_theta_apply := r.weighted_score;
      WHEN 'analyze' THEN v_theta_analyze := r.weighted_score;
      WHEN 'evaluate' THEN v_theta_analyze := v_theta_analyze + r.weighted_score * 0.5;
    END CASE;
  END LOOP;

  IF v_total > 0 THEN
    v_theta_overall := (v_theta_remember + v_theta_apply + v_theta_analyze) / 3.0;
  END IF;

  -- Confidence-adjusted theta (penalize low-confidence correct answers)
  SELECT
    avg(CASE
      WHEN qa.is_correct AND esq.user_confidence < 50 THEN eq.item_difficulty * 0.5
      WHEN NOT qa.is_correct AND esq.user_confidence > 70 THEN -eq.item_difficulty * 1.5
      WHEN qa.is_correct THEN eq.item_difficulty
      ELSE -eq.item_difficulty
    END)
  INTO v_conf_adj
  FROM public.question_attempts qa
  JOIN public.exam_questions eq ON eq.id = qa.question_id
  LEFT JOIN public.exam_session_questions esq
    ON esq.question_id = qa.question_id
    AND esq.exam_session_id = qa.session_id
  WHERE qa.user_id = p_user_id
    AND eq.curriculum_id = p_curriculum_id
    AND qa.answered_at > now() - interval '30 days';

  -- Pass probability: logistic function P = 1/(1+exp(-(theta - threshold)))
  -- threshold ~0.3 for IHK pass
  v_pass_prob := 1.0 / (1.0 + exp(-(v_theta_overall - 0.3) * 3.0));

  -- Upsert ability profile
  INSERT INTO public.user_ability_profiles (
    user_id, curriculum_id, theta_overall, theta_remember,
    theta_apply, theta_analyze, confidence_adjusted_theta,
    pass_probability, total_items_seen, updated_at
  ) VALUES (
    p_user_id, p_curriculum_id, v_theta_overall, v_theta_remember,
    v_theta_apply, v_theta_analyze, COALESCE(v_conf_adj, v_theta_overall),
    v_pass_prob, v_total, now()
  )
  ON CONFLICT (user_id, curriculum_id) DO UPDATE SET
    theta_overall = EXCLUDED.theta_overall,
    theta_remember = EXCLUDED.theta_remember,
    theta_apply = EXCLUDED.theta_apply,
    theta_analyze = EXCLUDED.theta_analyze,
    confidence_adjusted_theta = EXCLUDED.confidence_adjusted_theta,
    pass_probability = EXCLUDED.pass_probability,
    total_items_seen = EXCLUDED.total_items_seen,
    updated_at = now();

  RETURN jsonb_build_object(
    'theta_overall', v_theta_overall,
    'theta_remember', v_theta_remember,
    'theta_apply', v_theta_apply,
    'theta_analyze', v_theta_analyze,
    'confidence_adjusted_theta', COALESCE(v_conf_adj, v_theta_overall),
    'pass_probability', round(v_pass_prob::numeric * 100, 1),
    'total_items_seen', v_total
  );
END;
$$;
