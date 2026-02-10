
-- Unique indexes for idempotent curriculum imports
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_fields_curriculum_code 
  ON public.learning_fields (curriculum_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competencies_lf_code 
  ON public.competencies (learning_field_id, code);

-- Add import_source column to curricula for tracking how data was imported
ALTER TABLE public.curricula ADD COLUMN IF NOT EXISTS import_source TEXT DEFAULT 'manual';
ALTER TABLE public.curricula ADD COLUMN IF NOT EXISTS import_log JSONB DEFAULT '[]'::jsonb;
