
-- Varianten-Tabelle für Blueprint-basierte Fragenvarianten
CREATE TABLE IF NOT EXISTS public.exam_question_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL REFERENCES public.question_blueprints(id) ON DELETE CASCADE,
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  learning_field_id uuid REFERENCES public.learning_fields(id) ON DELETE SET NULL,
  competency_id uuid REFERENCES public.competencies(id) ON DELETE SET NULL,

  variant_type text NOT NULL CHECK (variant_type IN (
    'parameter_shift',
    'context_shift',
    'trap_shift',
    'structure_shift',
    'transfer_shift'
  )),

  question_type text NOT NULL DEFAULT 'concept',
  cognitive_level text NOT NULL DEFAULT 'apply',

  title text,
  question_text text NOT NULL CHECK (length(question_text) >= 10),
  answer_text text,
  options jsonb,
  correct_answer jsonb,

  trap_type text,
  trap_applied jsonb,
  distractor_meta jsonb,
  variables jsonb,
  scenario_context jsonb,

  quality_score numeric DEFAULT 0,
  quality_flags jsonb DEFAULT '[]'::jsonb,

  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_eqv_blueprint ON public.exam_question_variants(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_eqv_status ON public.exam_question_variants(status);
CREATE INDEX IF NOT EXISTS idx_eqv_curriculum ON public.exam_question_variants(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_eqv_variant_type ON public.exam_question_variants(variant_type);

-- RLS
ALTER TABLE public.exam_question_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on variants"
  ON public.exam_question_variants
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read variants"
  ON public.exam_question_variants
  FOR SELECT
  TO authenticated
  USING (true);

-- Updated_at trigger
CREATE TRIGGER update_exam_question_variants_updated_at
  BEFORE UPDATE ON public.exam_question_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
