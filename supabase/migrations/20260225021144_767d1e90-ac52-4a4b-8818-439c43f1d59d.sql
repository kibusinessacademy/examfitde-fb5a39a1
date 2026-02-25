
-- ============================================================
-- MiniCheck Questions: Polymorph extension (lesson + drill mode)
-- ============================================================

-- 1) Make lesson_id nullable (drill mode has no lesson)
ALTER TABLE public.minicheck_questions ALTER COLUMN lesson_id DROP NOT NULL;

-- 2) Add new columns for polymorph design
ALTER TABLE public.minicheck_questions
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'lesson',
  ADD COLUMN IF NOT EXISTS curriculum_id uuid,
  ADD COLUMN IF NOT EXISTS source_blueprint_id uuid,
  ADD COLUMN IF NOT EXISTS trap_tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS distractor_meta jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS cognitive_level text DEFAULT 'understand',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 3) Add constraint: mode must be 'lesson' or 'drill'
ALTER TABLE public.minicheck_questions
  ADD CONSTRAINT chk_minicheck_mode CHECK (mode IN ('lesson', 'drill'));

-- 4) Add constraint: lesson mode requires lesson_id
-- Using a trigger instead of CHECK for flexibility
CREATE OR REPLACE FUNCTION public.validate_minicheck_mode()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.mode = 'lesson' AND NEW.lesson_id IS NULL THEN
    RAISE EXCEPTION 'lesson_id is required when mode = lesson';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_minicheck_mode
  BEFORE INSERT OR UPDATE ON public.minicheck_questions
  FOR EACH ROW EXECUTE FUNCTION public.validate_minicheck_mode();

-- 5) Add updated_at trigger
CREATE TRIGGER update_minicheck_questions_updated_at
  BEFORE UPDATE ON public.minicheck_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6) Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_minicheck_mode ON public.minicheck_questions(mode);
CREATE INDEX IF NOT EXISTS idx_minicheck_curriculum ON public.minicheck_questions(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_minicheck_status ON public.minicheck_questions(status);
CREATE INDEX IF NOT EXISTS idx_minicheck_competency ON public.minicheck_questions(competency_id);
CREATE INDEX IF NOT EXISTS idx_minicheck_blueprint ON public.minicheck_questions(source_blueprint_id);

-- 7) Backfill existing rows (all are lesson-mode)
UPDATE public.minicheck_questions 
SET mode = 'lesson', status = 'approved'
WHERE mode = 'lesson';
