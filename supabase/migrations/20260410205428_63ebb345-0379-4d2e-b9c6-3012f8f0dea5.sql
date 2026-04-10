
-- 1. Add link_status column
ALTER TABLE minicheck_questions 
  ADD COLUMN IF NOT EXISTS link_status text DEFAULT 'linked';

-- 2. Backfill link_status based on current state
UPDATE minicheck_questions SET link_status = 'linked' WHERE lesson_id IS NOT NULL AND is_duplicate IS NOT TRUE;
UPDATE minicheck_questions SET link_status = 'link_pending' 
WHERE lesson_id IS NULL AND is_duplicate IS NOT TRUE AND competency_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM lessons l WHERE l.competency_id = minicheck_questions.competency_id);
UPDATE minicheck_questions SET link_status = 'unlinked_generic'
WHERE lesson_id IS NULL AND is_duplicate IS NOT TRUE
  AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.competency_id = minicheck_questions.competency_id);

-- 3. Index for quick filtering
CREATE INDEX IF NOT EXISTS idx_minicheck_link_status ON minicheck_questions (link_status) WHERE link_status != 'linked';

-- 4. Duplicate prevention trigger: block exact dupes within same lesson_id
CREATE OR REPLACE FUNCTION fn_guard_minicheck_duplicate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lesson_id IS NOT NULL AND NEW.is_duplicate IS NOT TRUE THEN
    IF EXISTS (
      SELECT 1 FROM minicheck_questions
      WHERE lesson_id = NEW.lesson_id
        AND id != NEW.id
        AND is_duplicate IS NOT TRUE
        AND lower(trim(question_text)) = lower(trim(NEW.question_text))
    ) THEN
      -- Don't crash, just mark as duplicate
      NEW.is_duplicate := true;
      NEW.dedupe_batch := 'guard_prevented';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_minicheck_duplicate
  BEFORE INSERT OR UPDATE ON minicheck_questions
  FOR EACH ROW EXECUTE FUNCTION fn_guard_minicheck_duplicate();
