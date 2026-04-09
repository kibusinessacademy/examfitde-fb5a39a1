
-- =====================================================
-- DROP OLD share_events (simple version)
-- =====================================================
DROP POLICY IF EXISTS "Users insert own shares" ON public.share_events;
DROP POLICY IF EXISTS "Users read own shares" ON public.share_events;
DROP TABLE IF EXISTS public.share_events CASCADE;

-- =====================================================
-- SHARE ENGINE TABLES
-- =====================================================

CREATE TABLE public.share_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NULL,
  competency_id uuid NULL,
  exam_session_id uuid NULL,
  exam_question_id uuid NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'exam_session_completed_high_score',
    'exam_session_improvement_milestone',
    'hard_question_correct',
    'competency_mastered',
    'streak_milestone'
  )),
  event_status text NOT NULL DEFAULT 'eligible' CHECK (event_status IN ('eligible','dismissed','shared','expired')),
  source_table text NULL,
  source_id uuid NULL,
  score_percent numeric(5,2) NULL,
  delta_percent numeric(5,2) NULL,
  difficulty_level text NULL,
  rarity_percent numeric(5,2) NULL,
  streak_days integer NULL,
  mastery_before text NULL,
  mastery_after text NULL,
  title text NOT NULL,
  subtitle text NULL,
  share_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz NULL,
  UNIQUE (user_id, event_type, source_id)
);

CREATE INDEX idx_share_events_user_created ON public.share_events (user_id, created_at DESC);
CREATE INDEX idx_share_events_status ON public.share_events (event_status);
CREATE INDEX idx_share_events_exam_session ON public.share_events (exam_session_id) WHERE exam_session_id IS NOT NULL;

CREATE TABLE public.share_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_event_id uuid NOT NULL REFERENCES public.share_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action_type text NOT NULL,
  channel text NOT NULL,
  recipient_email text NULL,
  platform text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_share_actions_event ON public.share_actions (share_event_id, created_at DESC);
CREATE INDEX idx_share_actions_user ON public.share_actions (user_id, created_at DESC);

CREATE TABLE public.share_preferences (
  user_id uuid PRIMARY KEY,
  allow_social_share boolean NOT NULL DEFAULT true,
  allow_email_share boolean NOT NULL DEFAULT true,
  auto_prompt_on_success boolean NOT NULL DEFAULT true,
  preferred_manager_email text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.share_email_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text NOT NULL,
  display_name text NULL,
  role_label text NULL,
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, email)
);

CREATE INDEX idx_share_email_recipients_user ON public.share_email_recipients (user_id);

-- =====================================================
-- TRIGGERS
-- =====================================================

CREATE OR REPLACE FUNCTION public.tg_set_updated_at_share()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_updated_at_share_events
BEFORE UPDATE ON public.share_events
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at_share();

CREATE TRIGGER trg_updated_at_share_preferences
BEFORE UPDATE ON public.share_preferences
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at_share();

-- =====================================================
-- RLS
-- =====================================================

ALTER TABLE public.share_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_email_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "share_events_select_own" ON public.share_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "share_events_update_own" ON public.share_events FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "share_actions_select_own" ON public.share_actions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "share_actions_insert_own" ON public.share_actions FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "share_prefs_select_own" ON public.share_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "share_prefs_insert_own" ON public.share_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "share_prefs_update_own" ON public.share_preferences FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "share_recipients_select_own" ON public.share_email_recipients FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "share_recipients_insert_own" ON public.share_email_recipients FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "share_recipients_update_own" ON public.share_email_recipients FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- RPCs – Event Emission (SECURITY DEFINER)
-- =====================================================

-- High Score + Improvement Milestone
CREATE OR REPLACE FUNCTION public.fn_emit_share_event_for_exam_session(
  p_exam_session_id uuid
)
RETURNS SETOF public.share_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session record;
  v_prev_median numeric;
  v_delta numeric;
BEGIN
  SELECT id, user_id, curriculum_id, score_percentage
  INTO v_session
  FROM exam_sessions
  WHERE id = p_exam_session_id;

  IF v_session.id IS NULL THEN RETURN; END IF;

  -- High Score (≥80%)
  IF COALESCE(v_session.score_percentage, 0) >= 80 THEN
    INSERT INTO share_events (
      user_id, curriculum_id, exam_session_id, event_type,
      source_table, source_id, score_percent,
      title, subtitle, share_payload
    ) VALUES (
      v_session.user_id, v_session.curriculum_id, v_session.id,
      'exam_session_completed_high_score', 'exam_sessions', v_session.id,
      v_session.score_percentage,
      'Starker Test abgeschlossen',
      'Du hast ' || round(v_session.score_percentage) || '% erreicht.',
      jsonb_build_object('score_percent', v_session.score_percentage, 'share_template', 'exam_session_completed_high_score')
    ) ON CONFLICT (user_id, event_type, source_id) DO NOTHING;
  END IF;

  -- Improvement (+15pp vs median of last 3)
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY score_percentage)
  INTO v_prev_median
  FROM (
    SELECT score_percentage FROM exam_sessions
    WHERE user_id = v_session.user_id
      AND curriculum_id = v_session.curriculum_id
      AND id <> v_session.id
      AND score_percentage IS NOT NULL
    ORDER BY created_at DESC LIMIT 3
  ) t;

  IF v_prev_median IS NOT NULL THEN
    v_delta := v_session.score_percentage - v_prev_median;
    IF v_delta >= 15 THEN
      INSERT INTO share_events (
        user_id, curriculum_id, exam_session_id, event_type,
        source_table, source_id, score_percent, delta_percent,
        title, subtitle, share_payload
      ) VALUES (
        v_session.user_id, v_session.curriculum_id, v_session.id,
        'exam_session_improvement_milestone', 'exam_sessions', v_session.id,
        v_session.score_percentage, v_delta,
        'Starke Verbesserung erreicht',
        'Du hast dich um ' || round(v_delta) || ' Prozentpunkte verbessert.',
        jsonb_build_object('score_percent', v_session.score_percentage, 'delta_percent', v_delta, 'share_template', 'exam_session_improvement_milestone')
      ) ON CONFLICT (user_id, event_type, source_id) DO NOTHING;
    END IF;
  END IF;

  RETURN QUERY SELECT * FROM share_events WHERE exam_session_id = p_exam_session_id ORDER BY created_at DESC;
END;
$$;

-- Hard Question Correct
CREATE OR REPLACE FUNCTION public.fn_emit_share_event_for_hard_question(
  p_user_id uuid,
  p_exam_question_id uuid,
  p_curriculum_id uuid,
  p_exam_session_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_success_rate numeric := 1;
  v_difficulty text;
  v_id uuid;
BEGIN
  SELECT COALESCE(eq.difficulty, 'unknown')
  INTO v_difficulty
  FROM exam_questions eq WHERE eq.id = p_exam_question_id;

  IF v_difficulty <> 'hard' THEN RETURN NULL; END IF;

  SELECT COALESCE(AVG(CASE WHEN esq.is_correct THEN 1.0 ELSE 0.0 END), 1.0)
  INTO v_success_rate
  FROM exam_session_questions esq WHERE esq.question_id = p_exam_question_id;

  IF v_success_rate > 0.35 THEN RETURN NULL; END IF;

  INSERT INTO share_events (
    user_id, curriculum_id, exam_session_id, exam_question_id,
    event_type, source_table, source_id, difficulty_level, rarity_percent,
    title, subtitle, share_payload
  ) VALUES (
    p_user_id, p_curriculum_id, p_exam_session_id, p_exam_question_id,
    'hard_question_correct', 'exam_questions', p_exam_question_id,
    'hard', round((1 - v_success_rate) * 100, 2),
    'Schwere Frage korrekt gelöst',
    'Nur ' || round(v_success_rate * 100) || '% beantworten diese Frage richtig.',
    jsonb_build_object('rarity_percent', round((1 - v_success_rate) * 100, 2), 'success_rate_percent', round(v_success_rate * 100, 2), 'share_template', 'hard_question_correct')
  ) ON CONFLICT (user_id, event_type, source_id) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Competency Mastered
CREATE OR REPLACE FUNCTION public.fn_emit_share_event_for_mastery_upgrade(
  p_user_id uuid,
  p_curriculum_id uuid,
  p_competency_id uuid,
  p_before text,
  p_after text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_after <> 'mastered' OR COALESCE(p_before, '') = 'mastered' THEN RETURN NULL; END IF;

  INSERT INTO share_events (
    user_id, curriculum_id, competency_id, event_type,
    source_table, source_id, mastery_before, mastery_after,
    title, subtitle, share_payload
  ) VALUES (
    p_user_id, p_curriculum_id, p_competency_id,
    'competency_mastered', 'competencies', p_competency_id,
    p_before, p_after,
    'Kompetenz gemeistert',
    'Du hast ein prüfungsrelevantes Thema sicher beherrscht.',
    jsonb_build_object('mastery_before', p_before, 'mastery_after', p_after, 'share_template', 'competency_mastered')
  ) ON CONFLICT (user_id, event_type, source_id) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
