-- Add missing columns for exam-pool generation
ALTER TABLE public.exam_questions
  ADD COLUMN IF NOT EXISTS certification_id uuid,
  ADD COLUMN IF NOT EXISTS review_state text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;

-- Indexes for exam-pool queries
CREATE INDEX IF NOT EXISTS idx_exam_questions_certification_id
  ON public.exam_questions(certification_id);

CREATE INDEX IF NOT EXISTS idx_exam_questions_competency_id
  ON public.exam_questions(competency_id);

CREATE INDEX IF NOT EXISTS idx_exam_questions_blueprint_id
  ON public.exam_questions(blueprint_id);