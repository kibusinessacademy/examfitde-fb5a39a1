
-- Hebel 3: Add distractor quality tracking to exam_questions
ALTER TABLE public.exam_questions
  ADD COLUMN IF NOT EXISTS trap_tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS distractor_meta jsonb DEFAULT '[]';

COMMENT ON COLUMN public.exam_questions.trap_tags IS 'IHK trap categories this question tests, e.g. netto_brutto, percent_base';
COMMENT ON COLUMN public.exam_questions.distractor_meta IS 'Per-option metadata: [{option_index, error_tag, why_wrong}]';

-- Add trap_spec to question_blueprints (structured trap definition)
ALTER TABLE public.question_blueprints
  ADD COLUMN IF NOT EXISTS trap_spec jsonb DEFAULT NULL;

COMMENT ON COLUMN public.question_blueprints.trap_spec IS 'Structured trap specification: {trap_tags, common_misconceptions, distractor_rules}';

-- Index for KPI queries
CREATE INDEX IF NOT EXISTS idx_exam_questions_trap_tags ON public.exam_questions USING gin(trap_tags);
