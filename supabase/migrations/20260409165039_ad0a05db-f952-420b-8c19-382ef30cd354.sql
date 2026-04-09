
ALTER TABLE exam_questions DISABLE TRIGGER USER;
UPDATE exam_questions SET status = 'approved'
WHERE status = 'draft' AND ai_generated = true
  AND curriculum_id = '225a26f3-cb03-4d0a-aac1-ba8fd1442272'
  AND learning_field_id = 'ced6fa04-948f-477f-8a73-85b4aebc86b0';
ALTER TABLE exam_questions ENABLE TRIGGER USER;
