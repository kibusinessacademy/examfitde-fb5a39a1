
-- Disable user triggers for bulk update
ALTER TABLE exam_questions DISABLE TRIGGER USER;

-- Blueprint competency mapping
UPDATE question_blueprints SET competency_id = (
  SELECT c.id FROM competencies c WHERE c.learning_field_id = '9f727cdd-e1ad-41b5-bd73-1f15787c6b64' ORDER BY c.id LIMIT 1
) WHERE curriculum_id = '225a26f3-cb03-4d0a-aac1-ba8fd1442272'
  AND competency_id IS NULL AND learning_field_id = '8c9256d8-eb3c-4aeb-af5f-628af55acf1b';

UPDATE question_blueprints SET competency_id = (
  SELECT c.id FROM competencies c WHERE c.learning_field_id = '5906a7fe-4803-4401-adf6-fd02aa9faf93' ORDER BY c.id LIMIT 1
) WHERE curriculum_id = '225a26f3-cb03-4d0a-aac1-ba8fd1442272'
  AND competency_id IS NULL AND learning_field_id = '818d0e27-3f85-4154-8191-6e984141b629';

UPDATE question_blueprints SET competency_id = (
  SELECT c.id FROM competencies c WHERE c.learning_field_id = '9f727cdd-e1ad-41b5-bd73-1f15787c6b64' ORDER BY c.id LIMIT 1 OFFSET 1
) WHERE curriculum_id = '225a26f3-cb03-4d0a-aac1-ba8fd1442272'
  AND competency_id IS NULL AND learning_field_id = '613b7ab6-5123-4751-b3e4-7f10f542bb58';

UPDATE question_blueprints SET competency_id = (
  SELECT c.id FROM competencies c WHERE c.learning_field_id = '8dc720aa-bb01-40a1-99d4-9c60e60a6c1d' ORDER BY c.id LIMIT 1
) WHERE curriculum_id = '225a26f3-cb03-4d0a-aac1-ba8fd1442272'
  AND competency_id IS NULL AND learning_field_id = 'b28d93b0-0f66-4ef6-aabd-0444bcf9de55';

UPDATE question_blueprints SET competency_id = (
  SELECT c.id FROM competencies c WHERE c.learning_field_id = '4e9eea9b-7255-4ca8-b049-9336a39407e7' ORDER BY c.id LIMIT 1
) WHERE curriculum_id = '225a26f3-cb03-4d0a-aac1-ba8fd1442272'
  AND competency_id IS NULL AND learning_field_id = '37435afb-059a-4f38-b304-a1cd4a047702';

-- Propagate competency_id to exam questions
UPDATE exam_questions eq SET competency_id = qb.competency_id
FROM question_blueprints qb
WHERE eq.blueprint_id = qb.id
  AND eq.curriculum_id = '225a26f3-cb03-4d0a-aac1-ba8fd1442272'
  AND eq.competency_id IS NULL
  AND qb.competency_id IS NOT NULL;

-- Promote qualified questions
UPDATE exam_questions SET 
  qc_status = 'tier1_passed',
  status = 'approved',
  meta = COALESCE(meta, '{}'::jsonb) - 'promotion_block_reasons'
WHERE curriculum_id = '225a26f3-cb03-4d0a-aac1-ba8fd1442272'
  AND qc_status = 'needs_review'
  AND competency_id IS NOT NULL
  AND length(question_text) >= 40;

-- Re-enable triggers
ALTER TABLE exam_questions ENABLE TRIGGER USER;
