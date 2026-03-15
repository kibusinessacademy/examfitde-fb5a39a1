
-- Add question_fingerprint column for batch-import dedup
ALTER TABLE public.exam_questions
  ADD COLUMN IF NOT EXISTS question_fingerprint text;

-- Partial unique index: only enforce uniqueness where fingerprint is set
CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_questions_fingerprint
  ON public.exam_questions(question_fingerprint)
  WHERE question_fingerprint IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN public.exam_questions.question_fingerprint IS 'SHA-256 hash of blueprint_id|normalized_question_text|normalized_correct_answer for batch-import idempotency';
