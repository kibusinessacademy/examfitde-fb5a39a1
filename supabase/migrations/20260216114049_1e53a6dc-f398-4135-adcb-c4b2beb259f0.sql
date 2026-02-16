
-- Add missing metadata column to oral_exam_blueprints that the edge function writes to
ALTER TABLE public.oral_exam_blueprints
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
