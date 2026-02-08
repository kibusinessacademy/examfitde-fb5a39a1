-- =====================================================
-- ORAL EXAM SESSIONS - Mündliche Prüfungssimulation
-- =====================================================

-- Oral Exam Session table
CREATE TABLE public.oral_exam_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL REFERENCES public.curricula(id),
  blueprint_id UUID REFERENCES public.exam_blueprints(id),
  
  -- Session configuration
  mode TEXT NOT NULL DEFAULT 'practice' CHECK (mode IN ('practice', 'simulation')),
  total_questions INTEGER NOT NULL DEFAULT 5,
  time_limit_minutes INTEGER DEFAULT 30,
  
  -- Session state
  current_question_index INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  
  -- Results
  overall_score NUMERIC(5,2),
  passed BOOLEAN,
  
  -- Detailed scoring (IHK-konform)
  fachlichkeit_score NUMERIC(5,2),
  struktur_score NUMERIC(5,2),
  begriffssicherheit_score NUMERIC(5,2),
  praxisbezug_score NUMERIC(5,2),
  
  -- AI feedback
  strengths TEXT[],
  weaknesses TEXT[],
  improvement_suggestions TEXT[],
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Oral Exam Questions (individual questions in a session)
CREATE TABLE public.oral_exam_questions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.oral_exam_sessions(id) ON DELETE CASCADE,
  
  -- Question source (SSOT - from blueprints)
  blueprint_id UUID REFERENCES public.question_blueprints(id),
  competency_id UUID REFERENCES public.competencies(id),
  learning_field_id UUID REFERENCES public.learning_fields(id),
  
  -- Generated question
  question_text TEXT NOT NULL,
  expected_answer_points TEXT[], -- Key points expected in answer
  follow_up_questions TEXT[], -- Potential follow-up questions
  
  -- Order and timing
  order_index INTEGER NOT NULL,
  time_limit_seconds INTEGER DEFAULT 180, -- 3 minutes per question
  
  -- User response
  user_answer TEXT,
  answer_started_at TIMESTAMPTZ,
  answer_submitted_at TIMESTAMPTZ,
  time_spent_seconds INTEGER,
  
  -- AI Evaluation (IHK criteria)
  fachlichkeit_score NUMERIC(3,2), -- 0-1 scale
  struktur_score NUMERIC(3,2),
  begriffssicherheit_score NUMERIC(3,2),
  praxisbezug_score NUMERIC(3,2),
  
  -- Feedback
  ai_feedback TEXT,
  covered_points TEXT[], -- Which expected points were covered
  missed_points TEXT[], -- Which expected points were missed
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.oral_exam_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_exam_questions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for oral_exam_sessions
CREATE POLICY "Users can view their own oral exam sessions" 
ON public.oral_exam_sessions FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own oral exam sessions" 
ON public.oral_exam_sessions FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own oral exam sessions" 
ON public.oral_exam_sessions FOR UPDATE 
USING (auth.uid() = user_id);

-- RLS Policies for oral_exam_questions
CREATE POLICY "Users can view their own oral exam questions" 
ON public.oral_exam_questions FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.oral_exam_sessions s 
  WHERE s.id = oral_exam_questions.session_id 
  AND s.user_id = auth.uid()
));

CREATE POLICY "Users can create oral exam questions in their sessions" 
ON public.oral_exam_questions FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.oral_exam_sessions s 
  WHERE s.id = oral_exam_questions.session_id 
  AND s.user_id = auth.uid()
));

CREATE POLICY "Users can update oral exam questions in their sessions" 
ON public.oral_exam_questions FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM public.oral_exam_sessions s 
  WHERE s.id = oral_exam_questions.session_id 
  AND s.user_id = auth.uid()
));

-- Indexes
CREATE INDEX idx_oral_exam_sessions_user ON public.oral_exam_sessions(user_id);
CREATE INDEX idx_oral_exam_sessions_curriculum ON public.oral_exam_sessions(curriculum_id);
CREATE INDEX idx_oral_exam_questions_session ON public.oral_exam_questions(session_id);
CREATE INDEX idx_oral_exam_questions_competency ON public.oral_exam_questions(competency_id);

-- Trigger for updated_at
CREATE TRIGGER update_oral_exam_sessions_updated_at
  BEFORE UPDATE ON public.oral_exam_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();