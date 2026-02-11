
-- 1. Add question_text_hash to blueprint_variants for text-level duplicate detection
ALTER TABLE public.blueprint_variants
ADD COLUMN IF NOT EXISTS question_text_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_blueprint_variants_text_hash
ON public.blueprint_variants (blueprint_id, question_text_hash);

-- 2. Add approval status to question_blueprints if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'question_blueprints' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.question_blueprints ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
  END IF;
END $$;

-- 3. Add unit field to blueprint_correct_answers for unit validation
ALTER TABLE public.blueprint_correct_answers
ADD COLUMN IF NOT EXISTS expected_unit TEXT;

COMMENT ON COLUMN public.blueprint_correct_answers.expected_unit IS 'Expected unit for calculated answers, e.g. €, %, Monate';

-- 4. Add extended constraint types support comment
COMMENT ON TABLE public.blueprint_constraints IS 'Supports constraint_type: forbidden, conditional, range, in_list, regex, implies_one_of';
