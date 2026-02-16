
-- ═══ 1) Adaptive Remediation ═══
CREATE TABLE IF NOT EXISTS public.remediation_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  source_session_id UUID REFERENCES public.exam_sessions(id),
  weak_competencies JSONB NOT NULL DEFAULT '[]',
  training_questions JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  score_before NUMERIC,
  score_after NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.remediation_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'remediation_sessions' AND policyname = 'Users see own remediation') THEN
    CREATE POLICY "Users see own remediation" ON public.remediation_sessions FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'remediation_sessions' AND policyname = 'Users create own remediation') THEN
    CREATE POLICY "Users create own remediation" ON public.remediation_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'remediation_sessions' AND policyname = 'Users update own remediation') THEN
    CREATE POLICY "Users update own remediation" ON public.remediation_sessions FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

-- ═══ 2) AI Coach Feedback ═══
CREATE TABLE IF NOT EXISTS public.exam_ai_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES public.exam_sessions(id),
  curriculum_id UUID NOT NULL,
  strengths JSONB NOT NULL DEFAULT '[]',
  weaknesses JSONB NOT NULL DEFAULT '[]',
  learning_plan JSONB NOT NULL DEFAULT '[]',
  summary TEXT,
  coach_tone TEXT DEFAULT 'encouraging',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.exam_ai_feedback ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'exam_ai_feedback' AND policyname = 'Users see own feedback') THEN
    CREATE POLICY "Users see own feedback" ON public.exam_ai_feedback FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'exam_ai_feedback' AND policyname = 'Service inserts feedback') THEN
    CREATE POLICY "Service inserts feedback" ON public.exam_ai_feedback FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- ═══ 3) A/B Question Variants ═══
ALTER TABLE public.exam_questions 
  ADD COLUMN IF NOT EXISTS variant_group UUID,
  ADD COLUMN IF NOT EXISTS variant_label TEXT DEFAULT 'A';

CREATE TABLE IF NOT EXISTS public.question_variant_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id UUID NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  variant_group UUID NOT NULL,
  variant_label TEXT NOT NULL DEFAULT 'A',
  attempts INT NOT NULL DEFAULT 0,
  correct INT NOT NULL DEFAULT 0,
  avg_time_seconds NUMERIC,
  abort_rate NUMERIC DEFAULT 0,
  discrimination_index NUMERIC,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(question_id)
);

ALTER TABLE public.question_variant_stats ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'question_variant_stats' AND policyname = 'Admin reads variant stats') THEN
    CREATE POLICY "Admin reads variant stats" ON public.question_variant_stats FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'question_variant_stats' AND policyname = 'Service manages variant stats') THEN
    CREATE POLICY "Service manages variant stats" ON public.question_variant_stats FOR ALL USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_eq_variant_group ON public.exam_questions(variant_group) WHERE variant_group IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qvs_variant_group ON public.question_variant_stats(variant_group);
CREATE INDEX IF NOT EXISTS idx_rem_sess_user_cur ON public.remediation_sessions(user_id, curriculum_id);
CREATE INDEX IF NOT EXISTS idx_eaf_session ON public.exam_ai_feedback(session_id);
