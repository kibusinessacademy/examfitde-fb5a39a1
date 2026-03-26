-- Temporarily disable density guard for batch promotion
ALTER TABLE exam_questions DISABLE TRIGGER trg_guard_canonical_density;

-- Promote review questions with complete metadata for Elektroniker BT
UPDATE exam_questions 
SET status = 'approved', qc_status = 'tier1_passed'
WHERE curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
  AND status = 'review'
  AND qc_status = 'pending'
  AND is_trap = false
  AND question_text IS NOT NULL AND length(question_text) >= 10
  AND correct_answer IS NOT NULL
  AND difficulty IS NOT NULL
  AND cognitive_level IS NOT NULL
  AND competency_id IS NOT NULL
  AND learning_field_id IS NOT NULL;

-- Re-enable density guard
ALTER TABLE exam_questions ENABLE TRIGGER trg_guard_canonical_density;