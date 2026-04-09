
ALTER TABLE exam_questions DISABLE TRIGGER USER;

UPDATE exam_questions 
SET status = 'approved'
WHERE status = 'draft'
  AND ai_generated = true
  AND curriculum_id IN (
    '225a26f3-cb03-4d0a-aac1-ba8fd1442272',
    '0e2605f4-20f8-44c8-b224-4b97a3511add',
    'a0b0c0d0-0002-4000-8000-000000000001',
    '7907a655-598b-4465-85dc-8d89d6837d3d',
    'fbc805ce-e798-4cf6-a189-20f147ae0f38',
    '516618c7-ba4d-4e1a-bee6-b609b513ebd3',
    'b4a6641a-c4f7-4d6d-a108-2e78ffc1ca75',
    'cb6e221d-120c-4bad-8c50-ea94e8b803d6',
    '0305fd16-7c82-4fd3-adff-42e7ce1b9933'
  );

ALTER TABLE exam_questions ENABLE TRIGGER USER;
