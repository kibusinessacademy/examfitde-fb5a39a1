
UPDATE exam_questions
SET qc_status = 'tier1_passed'
WHERE status = 'draft'
  AND qc_status = 'pending'
  AND learning_field_id IS NOT NULL
  AND competency_id IS NOT NULL
  AND difficulty IS NOT NULL
  AND cognitive_level IS NOT NULL
  AND correct_answer IS NOT NULL
  AND exam_part IS NOT NULL
  AND LENGTH(question_text) >= 60
  AND jsonb_array_length(options) >= 4
  AND explanation IS NOT NULL;
