
-- FIX 1: approved+retired → rejected (215 rows: 37 Elekt + 178 Mecha)
UPDATE exam_questions 
SET status = 'rejected'
WHERE status = 'approved' AND qc_status = 'retired'
  AND curriculum_id IN ('e06a570a-d810-410d-873a-c87229465f41', 'e24f7b10-0740-4729-8abe-e10fe765f6db');

-- FIX 2: approved+needs_revision → draft (3 rows)
UPDATE exam_questions 
SET status = 'draft'
WHERE status = 'approved' AND qc_status = 'needs_revision'
  AND curriculum_id IN ('e06a570a-d810-410d-873a-c87229465f41', 'e24f7b10-0740-4729-8abe-e10fe765f6db');

-- FIX 3: draft/pending → review so validation pipeline picks them up (42,369 rows)
UPDATE exam_questions 
SET status = 'review'
WHERE status = 'draft' AND qc_status = 'pending'
  AND curriculum_id IN ('e06a570a-d810-410d-873a-c87229465f41', 'e24f7b10-0740-4729-8abe-e10fe765f6db')
  AND question_text IS NOT NULL AND length(question_text) > 10
  AND options IS NOT NULL AND correct_answer IS NOT NULL
  AND difficulty IS NOT NULL AND cognitive_level IS NOT NULL
  AND competency_id IS NOT NULL AND learning_field_id IS NOT NULL;
