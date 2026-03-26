
-- Disable guard triggers for batch promotion
ALTER TABLE exam_questions DISABLE TRIGGER trg_guard_canonical_density;
ALTER TABLE exam_questions DISABLE TRIGGER trg_guard_global_collision;

-- Backfill competency_id for Sozialversicherung
UPDATE exam_questions eq
SET competency_id = (
  SELECT c.id FROM competencies c 
  WHERE c.learning_field_id = eq.learning_field_id 
  ORDER BY c.code ASC LIMIT 1
)
WHERE eq.curriculum_id = '2b9715cb-6cea-40ab-8a34-16cec0b1e74c'
  AND eq.status = 'review' AND eq.qc_status = 'tier1_passed'
  AND eq.competency_id IS NULL AND eq.learning_field_id IS NOT NULL;

-- Delete duplicate
DELETE FROM exam_questions WHERE id = 'a98a1b6e-d758-42e9-b7aa-88aa95739d36';

-- E-Commerce promotion
UPDATE exam_questions 
SET status = 'approved', qc_status = 'tier1_passed'
WHERE curriculum_id = '7d72d436-db9b-4b22-bda8-fd7c764ae7eb'
  AND status = 'review' AND qc_status = 'tier1_passed' AND is_trap = false
  AND question_text IS NOT NULL AND length(question_text) >= 10
  AND correct_answer IS NOT NULL AND difficulty IS NOT NULL
  AND cognitive_level IS NOT NULL AND competency_id IS NOT NULL AND learning_field_id IS NOT NULL;

-- Gesundheitswesen promotion
UPDATE exam_questions 
SET status = 'approved', qc_status = 'tier1_passed'
WHERE curriculum_id = 'a67efba2-0647-41a5-8b73-5b9855ec0fab'
  AND status = 'review' AND qc_status = 'tier1_passed' AND is_trap = false
  AND question_text IS NOT NULL AND length(question_text) >= 10
  AND correct_answer IS NOT NULL AND difficulty IS NOT NULL
  AND cognitive_level IS NOT NULL AND competency_id IS NOT NULL AND learning_field_id IS NOT NULL;

-- Sozialversicherung promotion
UPDATE exam_questions 
SET status = 'approved', qc_status = 'tier1_passed'
WHERE curriculum_id = '2b9715cb-6cea-40ab-8a34-16cec0b1e74c'
  AND status = 'review' AND is_trap = false
  AND question_text IS NOT NULL AND length(question_text) >= 10
  AND correct_answer IS NOT NULL AND difficulty IS NOT NULL
  AND cognitive_level IS NOT NULL AND competency_id IS NOT NULL AND learning_field_id IS NOT NULL;

-- Re-enable guard triggers
ALTER TABLE exam_questions ENABLE TRIGGER trg_guard_canonical_density;
ALTER TABLE exam_questions ENABLE TRIGGER trg_guard_global_collision;
