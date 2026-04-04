
-- Idempotent unique constraint for competency seeding
CREATE UNIQUE INDEX IF NOT EXISTS idx_competencies_lf_code_unique
ON public.competencies (learning_field_id, code)
WHERE code IS NOT NULL;
