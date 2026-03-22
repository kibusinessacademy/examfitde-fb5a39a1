
-- =====================================================
-- EXAM QUALITY TRIFECTA: Schema for all 3 fixes
-- Fix 1: Difficulty rebalancing targets
-- Fix 2: Exam-Part mapping + inheritance
-- Fix 3: Trap system
-- =====================================================

-- Fix 2: Exam-Part Mappings table (manual mapping per curriculum)
CREATE TABLE IF NOT EXISTS public.exam_part_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  learning_field_id uuid NOT NULL REFERENCES public.learning_fields(id) ON DELETE CASCADE,
  exam_part text NOT NULL CHECK (exam_part IN ('teil_1', 'teil_2')),
  exam_weight numeric NOT NULL DEFAULT 1.0 CHECK (exam_weight >= 0 AND exam_weight <= 100),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (curriculum_id, learning_field_id)
);

ALTER TABLE public.exam_part_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on exam_part_mappings"
  ON public.exam_part_mappings FOR ALL
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.exam_part_mappings IS 
  'SSOT mapping: which learning fields belong to Teil 1 vs Teil 2 per curriculum. Questions inherit exam_part via their competency → learning_field chain.';

-- Fix 2: Add exam_weight to exam_questions (exam_part already exists)
ALTER TABLE public.exam_questions 
  ADD COLUMN IF NOT EXISTS exam_weight numeric DEFAULT NULL;

-- Fix 3: Trap columns on exam_questions
ALTER TABLE public.exam_questions 
  ADD COLUMN IF NOT EXISTS trap_type text DEFAULT NULL
    CHECK (trap_type IS NULL OR trap_type IN (
      'typical_error',
      'misconception',
      'incomplete_logic',
      'practice_error',
      'operator_risk',
      'calculation_trap'
    ));

ALTER TABLE public.exam_questions 
  ADD COLUMN IF NOT EXISTS is_trap boolean NOT NULL DEFAULT false;

-- Fix 1: Difficulty distribution targets (configurable per track)
CREATE TABLE IF NOT EXISTS public.difficulty_distribution_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track text NOT NULL DEFAULT 'AUSBILDUNG_VOLL',
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'very_hard')),
  target_pct numeric NOT NULL CHECK (target_pct >= 0 AND target_pct <= 100),
  tolerance_pct numeric NOT NULL DEFAULT 3.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (track, difficulty)
);

ALTER TABLE public.difficulty_distribution_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on difficulty_distribution_targets"
  ON public.difficulty_distribution_targets FOR ALL
  USING (true) WITH CHECK (true);

-- Seed default targets
INSERT INTO public.difficulty_distribution_targets (track, difficulty, target_pct, tolerance_pct) VALUES
  ('AUSBILDUNG_VOLL', 'easy',      10, 5),
  ('AUSBILDUNG_VOLL', 'medium',    45, 5),
  ('AUSBILDUNG_VOLL', 'hard',      30, 5),
  ('AUSBILDUNG_VOLL', 'very_hard', 15, 5)
ON CONFLICT (track, difficulty) DO NOTHING;

-- Fix 2: Trigger to auto-inherit exam_part from mapping when question is created/updated
CREATE OR REPLACE FUNCTION public.fn_inherit_exam_part_from_mapping()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lf_id uuid;
  v_mapping record;
BEGIN
  IF NEW.exam_part IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_lf_id := NEW.learning_field_id;
  
  IF v_lf_id IS NULL AND NEW.competency_id IS NOT NULL THEN
    SELECT c.learning_field_id INTO v_lf_id
    FROM competencies c WHERE c.id = NEW.competency_id;
  END IF;

  IF v_lf_id IS NULL OR NEW.curriculum_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT epm.exam_part, epm.exam_weight INTO v_mapping
  FROM exam_part_mappings epm
  WHERE epm.curriculum_id = NEW.curriculum_id
    AND epm.learning_field_id = v_lf_id;

  IF FOUND THEN
    NEW.exam_part := v_mapping.exam_part;
    IF NEW.exam_weight IS NULL THEN
      NEW.exam_weight := v_mapping.exam_weight;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inherit_exam_part ON public.exam_questions;
CREATE TRIGGER trg_inherit_exam_part
  BEFORE INSERT OR UPDATE ON public.exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_inherit_exam_part_from_mapping();

-- Fix 3: Auto-set is_trap based on trap_type
CREATE OR REPLACE FUNCTION public.fn_sync_is_trap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_trap := (NEW.trap_type IS NOT NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_is_trap ON public.exam_questions;
CREATE TRIGGER trg_sync_is_trap
  BEFORE INSERT OR UPDATE OF trap_type ON public.exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_is_trap();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exam_questions_trap_type 
  ON public.exam_questions (trap_type) WHERE trap_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exam_questions_exam_part
  ON public.exam_questions (exam_part) WHERE exam_part IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exam_questions_is_trap
  ON public.exam_questions (is_trap) WHERE is_trap = true;
