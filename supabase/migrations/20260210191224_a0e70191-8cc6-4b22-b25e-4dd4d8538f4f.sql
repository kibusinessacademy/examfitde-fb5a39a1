
-- Support KI response log (every AI answer is logged, versioned, explainable)
CREATE TABLE IF NOT EXISTS public.support_ai_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  answer_type text NOT NULL DEFAULT 'explanation', -- explanation, exam_trap, exercise_link, reassurance
  context_course_id uuid REFERENCES public.courses(id),
  context_lesson_id uuid REFERENCES public.lessons(id),
  context_competency_id uuid REFERENCES public.competencies(id),
  model_used text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  tokens_used integer,
  was_helpful boolean,
  feedback_text text,
  guardrail_flags jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_ai_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own AI responses"
  ON public.support_ai_responses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all AI responses"
  ON public.support_ai_responses FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "System can insert AI responses"
  ON public.support_ai_responses FOR INSERT
  WITH CHECK (true);

-- Support feedback loop: tickets classified for product improvement
CREATE TABLE IF NOT EXISTS public.support_feedback_loop (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  classification text NOT NULL, -- didactic_problem, understanding_gap, unclear_question, technical_problem
  affected_course_id uuid REFERENCES public.courses(id),
  affected_lesson_id uuid REFERENCES public.lessons(id),
  affected_competency_id uuid REFERENCES public.competencies(id),
  improvement_type text, -- better_explanation, new_minicheck, additional_example, fix_content
  improvement_status text NOT NULL DEFAULT 'candidate', -- candidate, approved, implemented, rejected
  auto_detected boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.support_feedback_loop ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage feedback loop"
  ON public.support_feedback_loop FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Add resolved_by and resolution_notes to support_tickets for FAQ pipeline
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS resolved_by uuid,
  ADD COLUMN IF NOT EXISTS resolution_notes text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_response_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS was_self_resolved boolean DEFAULT false;

-- Index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_support_tickets_type_status ON public.support_tickets(ticket_type, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_sentiment ON public.support_tickets(sentiment);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON public.support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_feedback_loop_status ON public.support_feedback_loop(improvement_status);
