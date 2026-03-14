
-- Step 1: Delete exact duplicate MiniCheck questions per lesson, keeping the oldest
DELETE FROM public.minicheck_questions
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY lesson_id, md5(question_text)
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.minicheck_questions
    WHERE lesson_id IS NOT NULL
  ) dupes
  WHERE rn > 1
);

-- Step 2: Delete exact duplicate drill questions per competency
DELETE FROM public.minicheck_questions
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY competency_id, md5(question_text)
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.minicheck_questions
    WHERE competency_id IS NOT NULL AND lesson_id IS NULL
  ) dupes
  WHERE rn > 1
);

-- Step 3: Now create unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_minicheck_lesson_question_text
  ON public.minicheck_questions (lesson_id, md5(question_text))
  WHERE lesson_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_minicheck_drill_question_text
  ON public.minicheck_questions (competency_id, md5(question_text))
  WHERE competency_id IS NOT NULL AND lesson_id IS NULL;
