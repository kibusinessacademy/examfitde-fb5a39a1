
-- Reject non-promotable draft+tier1_passed questions that block the validator gate
-- These lack required elite guard fields and cannot be promoted
-- The approved pool is already large enough (1786-1991 per curriculum)

-- 1. Reject drafts missing competency_id
UPDATE exam_questions
SET status = 'rejected', qc_status = 'rejected'
WHERE status = 'draft'
  AND qc_status = 'tier1_passed'
  AND competency_id IS NULL
  AND curriculum_id IN (
    '71fc8bdb-ba5a-4808-8d37-3752eeee6d6b',
    '7790d18f-8fb8-450a-9eb2-e2264d0c76c9',
    '0305fd16-7c82-4fd3-adff-42e7ce1b9933'
  );

-- 2. Reject drafts with short question_text (< 60 chars)
UPDATE exam_questions
SET status = 'rejected', qc_status = 'rejected'
WHERE status = 'draft'
  AND qc_status = 'tier1_passed'
  AND (question_text IS NULL OR length(question_text) < 60)
  AND curriculum_id IN (
    '71fc8bdb-ba5a-4808-8d37-3752eeee6d6b',
    '7790d18f-8fb8-450a-9eb2-e2264d0c76c9',
    '0305fd16-7c82-4fd3-adff-42e7ce1b9933'
  );
