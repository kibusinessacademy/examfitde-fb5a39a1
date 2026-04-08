
ALTER TABLE exam_questions DISABLE TRIGGER exam_questions_enforce_learning_field_id;
ALTER TABLE exam_questions DISABLE TRIGGER trg_exam_questions_enforce_learning_field_id;

UPDATE exam_questions eq
SET learning_field_id = (SELECT c.learning_field_id FROM competencies c WHERE c.id = eq.competency_id),
    status = 'rejected'
WHERE id IN (
  '508c17d9-059a-4187-b424-af3780f48427',
  '1f14912a-3fb2-4a9b-93d2-d10a78e72255',
  '8dea08a2-fb76-46bc-8496-e45d612db9b9',
  '5a1feb02-9b95-4a30-925a-c8d29c99bc3c',
  'ff9054ce-009e-4925-aa57-4ff4f886c0e1',
  '5545a64e-e9b6-40f4-afd1-0c0fe69b9855',
  '6a07a616-f7a0-4fff-a7e8-14c6dfe66e64',
  '8715b73b-3ad1-4243-8cd0-ad935e499154',
  '545c6146-b7a5-4481-aa69-adef77ac427c',
  'de5f4ac8-1757-4e85-81ef-7930a5276453'
);

ALTER TABLE exam_questions ENABLE TRIGGER exam_questions_enforce_learning_field_id;
ALTER TABLE exam_questions ENABLE TRIGGER trg_exam_questions_enforce_learning_field_id;
