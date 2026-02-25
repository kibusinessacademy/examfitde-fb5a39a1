
-- Add premium_upgraded_at audit timestamp to question_blueprints and oral_exam_blueprints
ALTER TABLE public.question_blueprints
  ADD COLUMN IF NOT EXISTS premium_upgraded_at timestamptz DEFAULT NULL;

ALTER TABLE public.oral_exam_blueprints
  ADD COLUMN IF NOT EXISTS premium_upgraded_at timestamptz DEFAULT NULL;
