
ALTER TABLE exam_questions DISABLE TRIGGER USER;

UPDATE exam_questions 
SET status = 'approved'
WHERE curriculum_id = '192af095-c7b8-4556-b0a7-246ef54749e1'
  AND status = 'draft'
  AND ai_generated = true;

ALTER TABLE exam_questions ENABLE TRIGGER USER;
