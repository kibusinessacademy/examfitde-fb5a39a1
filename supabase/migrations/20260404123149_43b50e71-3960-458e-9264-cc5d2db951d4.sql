
-- Persistent AI Tutor Sessions
CREATE TABLE public.ai_tutor_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  lesson_id uuid,
  competency_id uuid,
  minicheck_attempt_id uuid,
  exam_session_id uuid REFERENCES public.exam_sessions(id),
  mode text NOT NULL DEFAULT 'learning',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_tutor_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tutor sessions"
  ON public.ai_tutor_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tutor sessions"
  ON public.ai_tutor_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tutor sessions"
  ON public.ai_tutor_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tutor sessions"
  ON public.ai_tutor_sessions FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_tutor_sessions_user_curriculum
  ON public.ai_tutor_sessions(user_id, curriculum_id);

CREATE INDEX idx_tutor_sessions_status
  ON public.ai_tutor_sessions(status) WHERE status = 'active';

-- Persistent AI Tutor Messages  
CREATE TABLE public.ai_tutor_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.ai_tutor_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  source_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_tutor_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tutor messages"
  ON public.ai_tutor_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.ai_tutor_sessions s
    WHERE s.id = session_id AND s.user_id = auth.uid()
  ));

CREATE POLICY "Users can create own tutor messages"
  ON public.ai_tutor_messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ai_tutor_sessions s
    WHERE s.id = session_id AND s.user_id = auth.uid()
  ));

CREATE INDEX idx_tutor_messages_session
  ON public.ai_tutor_messages(session_id, created_at);
