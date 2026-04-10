
-- Add dedupe columns to minicheck_questions
ALTER TABLE minicheck_questions 
  ADD COLUMN IF NOT EXISTS is_duplicate boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid,
  ADD COLUMN IF NOT EXISTS dedupe_batch text;

CREATE INDEX IF NOT EXISTS idx_minicheck_is_duplicate ON minicheck_questions (is_duplicate) WHERE is_duplicate = true;

-- Phase 1: Soft-archive exact intra-lesson minicheck duplicates
-- Canonical = approved first, then oldest
WITH normalized AS (
  SELECT id, curriculum_id, lesson_id,
         lower(trim(question_text)) AS norm_text,
         CASE WHEN status IN ('approved','tier1_passed') THEN 0 ELSE 1 END AS approval_rank,
         created_at,
         ROW_NUMBER() OVER (
           PARTITION BY curriculum_id, lesson_id, lower(trim(question_text))
           ORDER BY 
             CASE WHEN status IN ('approved','tier1_passed') THEN 0 ELSE 1 END ASC,
             created_at ASC
         ) AS rn
  FROM minicheck_questions
  WHERE lesson_id IS NOT NULL
),
canonicals AS (
  SELECT id AS canonical_id, curriculum_id, lesson_id, norm_text
  FROM normalized WHERE rn = 1
),
duplicates AS (
  SELECT n.id AS dupe_id, c.canonical_id
  FROM normalized n
  JOIN canonicals c ON c.curriculum_id = n.curriculum_id 
    AND c.lesson_id = n.lesson_id 
    AND c.norm_text = n.norm_text
  WHERE n.rn > 1
)
UPDATE minicheck_questions mq
SET is_duplicate = true,
    duplicate_of = d.canonical_id,
    dedupe_batch = 'phase1_intra_lesson_2026-04-10',
    status = 'archived_duplicate'
FROM duplicates d
WHERE mq.id = d.dupe_id;
