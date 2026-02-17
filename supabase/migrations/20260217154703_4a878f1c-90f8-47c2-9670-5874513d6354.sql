
-- Add learning_field_id to oral_exam_blueprints for LF-proportional distribution
ALTER TABLE public.oral_exam_blueprints 
ADD COLUMN IF NOT EXISTS learning_field_id uuid REFERENCES public.learning_fields(id);

-- Backfill learning_field_id from competency → learning_field chain
UPDATE public.oral_exam_blueprints oeb
SET learning_field_id = comp.learning_field_id
FROM public.competencies comp
WHERE oeb.competency_id = comp.id
  AND oeb.learning_field_id IS NULL
  AND comp.learning_field_id IS NOT NULL;

-- Also update check constraint to include 'done' as valid status 
-- to prevent silent failures in the future
ALTER TABLE public.course_packages DROP CONSTRAINT IF EXISTS course_packages_status_check;
ALTER TABLE public.course_packages ADD CONSTRAINT course_packages_status_check 
  CHECK (status = ANY (ARRAY['planning','council_review','queued','building','qa','published','failed','blocked','done']));
