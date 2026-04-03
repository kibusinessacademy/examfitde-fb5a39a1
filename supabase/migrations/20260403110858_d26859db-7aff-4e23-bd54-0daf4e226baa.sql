
-- ============================================================
-- P0 Migration: ExamFit → program_type-fähiges Core-System
-- Additiv, nicht destruktiv. Bestehende Flows bleiben intakt.
-- ============================================================

-- 1. programs: leichte Gruppierungsebene
CREATE TABLE public.programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_type text NOT NULL DEFAULT 'vocational'
    CHECK (program_type IN ('vocational','higher_education','continuing_education')),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  degree_type text,
  institution_type text,
  institution_name text,
  field_of_study text,
  ects_total numeric,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','archived')),
  language_code text NOT NULL DEFAULT 'de',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Programs are readable by authenticated users"
  ON public.programs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Programs are manageable by admins"
  ON public.programs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. curricula: program_type + program_id additiv
ALTER TABLE public.curricula
  ADD COLUMN IF NOT EXISTS program_type text NOT NULL DEFAULT 'vocational'
    CHECK (program_type IN ('vocational','higher_education','continuing_education'));

ALTER TABLE public.curricula
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES public.programs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_curricula_program_type ON public.curricula(program_type);
CREATE INDEX IF NOT EXISTS idx_curricula_program_id ON public.curricula(program_id);

-- 3. learning_fields: Modul-Metadaten für Uni
ALTER TABLE public.learning_fields
  ADD COLUMN IF NOT EXISTS ects numeric,
  ADD COLUMN IF NOT EXISTS semester_recommended integer,
  ADD COLUMN IF NOT EXISTS exam_type text CHECK (exam_type IN ('written','oral','paper','presentation','mixed'));

-- 4. lesson_step enum: reflektieren + transfer
ALTER TYPE public.lesson_step ADD VALUE IF NOT EXISTS 'reflektieren' AFTER 'anwenden';
ALTER TYPE public.lesson_step ADD VALUE IF NOT EXISTS 'transfer' AFTER 'reflektieren';

-- 5. question_blueprints: rubric
ALTER TABLE public.question_blueprints
  ADD COLUMN IF NOT EXISTS rubric jsonb;

-- 6. exam_questions: rubric + expected_answer_points
ALTER TABLE public.exam_questions
  ADD COLUMN IF NOT EXISTS rubric jsonb,
  ADD COLUMN IF NOT EXISTS expected_answer_points jsonb;

-- 7. certification_type enum: studium
ALTER TYPE public.certification_type ADD VALUE IF NOT EXISTS 'studium';

-- 8. product_track enum: STUDIUM
ALTER TYPE public.product_track ADD VALUE IF NOT EXISTS 'STUDIUM';

-- 9. Updated-at trigger for programs
CREATE TRIGGER update_programs_updated_at
  BEFORE UPDATE ON public.programs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
