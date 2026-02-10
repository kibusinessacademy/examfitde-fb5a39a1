
-- Extend support_tickets with smart context fields
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS ticket_type text DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS context_course_id uuid REFERENCES public.courses(id),
  ADD COLUMN IF NOT EXISTS context_lesson_id uuid REFERENCES public.lessons(id),
  ADD COLUMN IF NOT EXISTS context_competency_id uuid REFERENCES public.competencies(id),
  ADD COLUMN IF NOT EXISTS context_exam_session_id uuid REFERENCES public.exam_sessions(id),
  ADD COLUMN IF NOT EXISTS context_url text,
  ADD COLUMN IF NOT EXISTS context_last_error text,
  ADD COLUMN IF NOT EXISTS context_learning_phase text,
  ADD COLUMN IF NOT EXISTS context_readiness_score numeric,
  ADD COLUMN IF NOT EXISTS auto_suggested_answer text,
  ADD COLUMN IF NOT EXISTS auto_resolved boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sentiment text DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS resolution_notes text,
  ADD COLUMN IF NOT EXISTS feedback_rating integer,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

COMMENT ON COLUMN public.support_tickets.ticket_type IS 'verstaendnisfrage | technisch | pruefungsangst | lernstrategie | abrechnung | general';
COMMENT ON COLUMN public.support_tickets.sentiment IS 'positive | neutral | frustrated | anxious | overwhelmed';
COMMENT ON COLUMN public.support_tickets.context_learning_phase IS 'onboarding | learning | practicing | exam_prep | post_exam';

-- Create support_faq table
CREATE TABLE IF NOT EXISTS public.support_faq (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  ticket_type text,
  course_id uuid REFERENCES public.courses(id),
  competency_id uuid REFERENCES public.competencies(id),
  learning_phase text,
  target_audience text DEFAULT 'learner',
  usage_count integer DEFAULT 0,
  helpful_count integer DEFAULT 0,
  is_published boolean DEFAULT false,
  auto_generated boolean DEFAULT false,
  source_ticket_id uuid REFERENCES public.support_tickets(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.support_faq ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read published FAQs"
  ON public.support_faq FOR SELECT
  USING (is_published = true);

CREATE POLICY "Admins can manage FAQs"
  ON public.support_faq FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Create support_suggestions table
CREATE TABLE IF NOT EXISTS public.support_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type text NOT NULL,
  context_pattern jsonb NOT NULL DEFAULT '{}',
  suggestion_text text NOT NULL,
  success_rate numeric DEFAULT 0,
  times_shown integer DEFAULT 0,
  times_accepted integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.support_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active suggestions"
  ON public.support_suggestions FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage suggestions"
  ON public.support_suggestions FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );
