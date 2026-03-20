-- Prune 384 weakest easy questions for MFA (curriculum_id = 105dd602)
-- Strategy: reject the 384 easy questions with lowest item_difficulty (weakest)
-- This brings easy% from 23.4% to ~15%
WITH to_reject AS (
  SELECT id
  FROM exam_questions
  WHERE curriculum_id = '105dd602-ea07-478f-8593-fd149ec5b676'
    AND status != 'rejected'
    AND difficulty = 'easy'
  ORDER BY item_difficulty ASC NULLS FIRST, created_at ASC
  LIMIT 384
)
UPDATE exam_questions
SET status = 'rejected',
    qc_status = 'rejected',
    reviewed_at = now()
WHERE id IN (SELECT id FROM to_reject);