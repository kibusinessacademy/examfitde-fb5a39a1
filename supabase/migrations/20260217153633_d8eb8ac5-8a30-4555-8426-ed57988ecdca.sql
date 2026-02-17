
-- Add competency_id to handbook_sections for direct competency linkage
ALTER TABLE public.handbook_sections 
ADD COLUMN IF NOT EXISTS competency_id uuid REFERENCES public.competencies(id);

-- Add learning_field_id for LF-level tracking
ALTER TABLE public.handbook_sections 
ADD COLUMN IF NOT EXISTS learning_field_id uuid REFERENCES public.learning_fields(id);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_handbook_sections_competency ON public.handbook_sections(competency_id);
CREATE INDEX IF NOT EXISTS idx_handbook_sections_lf ON public.handbook_sections(learning_field_id);
