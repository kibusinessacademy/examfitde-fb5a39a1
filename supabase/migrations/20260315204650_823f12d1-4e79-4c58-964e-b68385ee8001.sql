
-- ============================================
-- ExamFit v2: Learning Intelligence Layer
-- ============================================

BEGIN;

-- 1. Learning Events (Telemetry)
CREATE TABLE public.learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE SET NULL,
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE SET NULL,
  competency_id uuid REFERENCES public.competencies(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_source text NOT NULL DEFAULT 'system',
  duration_seconds int,
  score numeric,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_learning_events_user_created ON public.learning_events (user_id, created_at DESC);
CREATE INDEX idx_learning_events_type ON public.learning_events (event_type, created_at DESC);
CREATE INDEX idx_learning_events_curriculum ON public.learning_events (curriculum_id, user_id, created_at DESC);

ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own events"
  ON public.learning_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own events"
  ON public.learning_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access on learning_events"
  ON public.learning_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- 2. Exam Readiness Snapshots (persisted history)
CREATE TABLE public.exam_readiness_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  readiness_score numeric NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'unknown',
  confidence_score numeric NOT NULL DEFAULT 0,
  based_on_attempts int NOT NULL DEFAULT 0,
  based_on_competencies int NOT NULL DEFAULT 0,
  mastered_count int NOT NULL DEFAULT 0,
  partial_count int NOT NULL DEFAULT 0,
  not_mastered_count int NOT NULL DEFAULT 0,
  last_exam_sim_score numeric,
  weak_competencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  strong_competencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  version text NOT NULL DEFAULT 'v1',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_readiness_snapshots_user_curr ON public.exam_readiness_snapshots (user_id, curriculum_id, calculated_at DESC);

ALTER TABLE public.exam_readiness_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own readiness"
  ON public.exam_readiness_snapshots FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on readiness"
  ON public.exam_readiness_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- 3. User Recommendations
CREATE TABLE public.user_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  recommendation_type text NOT NULL,
  target_id uuid,
  target_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason_code text NOT NULL,
  reason_text text NOT NULL DEFAULT '',
  priority_score numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  clicked_at timestamptz
);

CREATE INDEX idx_recommendations_user_active ON public.user_recommendations (user_id, curriculum_id, is_active, priority_score DESC);

ALTER TABLE public.user_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own recommendations"
  ON public.user_recommendations FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own recommendations"
  ON public.user_recommendations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access on recommendations"
  ON public.user_recommendations FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- 4. Views

-- Latest readiness per user/curriculum
CREATE OR REPLACE VIEW public.v_user_current_readiness AS
SELECT DISTINCT ON (user_id, curriculum_id)
  id,
  user_id,
  curriculum_id,
  readiness_score,
  risk_level,
  confidence_score,
  based_on_attempts,
  based_on_competencies,
  mastered_count,
  partial_count,
  not_mastered_count,
  last_exam_sim_score,
  weak_competencies,
  strong_competencies,
  calculated_at
FROM public.exam_readiness_snapshots
ORDER BY user_id, curriculum_id, calculated_at DESC;

-- Active recommendations sorted by priority
CREATE OR REPLACE VIEW public.v_user_active_recommendations AS
SELECT
  r.id,
  r.user_id,
  r.curriculum_id,
  r.recommendation_type,
  r.target_id,
  r.target_meta,
  r.reason_code,
  r.reason_text,
  r.priority_score,
  r.generated_at,
  r.expires_at
FROM public.user_recommendations r
WHERE r.is_active = true
  AND (r.expires_at IS NULL OR r.expires_at > now())
ORDER BY r.priority_score DESC;

-- Top weakness competencies per user (from user_competency_mastery + stats)
CREATE OR REPLACE VIEW public.v_user_top_gaps AS
SELECT
  ucm.user_id,
  ucm.curriculum_id,
  ucm.competency_id,
  c.title AS competency_title,
  c.code AS competency_code,
  lf.code AS learning_field_code,
  lf.title AS learning_field_title,
  ucm.mastery_score,
  ucm.mastery_state,
  ucs.total_attempts,
  ucs.correct_attempts,
  CASE WHEN ucs.total_attempts > 0
    THEN round((ucs.correct_attempts::numeric / ucs.total_attempts) * 100, 1)
    ELSE 0
  END AS accuracy_pct,
  CASE
    WHEN ucm.mastery_state = 'not_mastered' AND ucs.total_attempts >= 3 THEN 'acute'
    WHEN ucm.mastery_state = 'partial' AND ucs.total_attempts >= 3 THEN 'unstable'
    WHEN ucs.total_attempts < 3 THEN 'blind'
    ELSE 'none'
  END AS gap_type,
  -- weakness_score: higher = worse
  CASE WHEN ucs.total_attempts > 0
    THEN round((1.0 - (ucs.correct_attempts::numeric / ucs.total_attempts)) * 100, 1)
    ELSE 50
  END AS weakness_score
FROM public.user_competency_mastery ucm
JOIN public.competencies c ON c.id = ucm.competency_id
JOIN public.learning_fields lf ON lf.id = c.learning_field_id
LEFT JOIN public.user_competency_stats ucs
  ON ucs.user_id = ucm.user_id
  AND ucs.competency_id = ucm.competency_id
  AND ucs.curriculum_id = ucm.curriculum_id
WHERE ucm.mastery_state IN ('not_mastered', 'partial')
ORDER BY weakness_score DESC;

-- Readiness trend (last 10 snapshots)
CREATE OR REPLACE VIEW public.v_user_readiness_trend AS
SELECT
  user_id,
  curriculum_id,
  readiness_score,
  risk_level,
  mastered_count,
  calculated_at
FROM public.exam_readiness_snapshots
ORDER BY user_id, curriculum_id, calculated_at DESC;

COMMIT;
