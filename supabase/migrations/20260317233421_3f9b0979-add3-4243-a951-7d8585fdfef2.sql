
-- PHASE 5: Additional understand fill from analyze/hard excess (analyze=32.1%, target=20%)
UPDATE exam_questions
SET cognitive_level = 'understand'
WHERE id IN (
  SELECT eq.id
  FROM exam_questions eq
  JOIN competencies comp ON comp.id = eq.competency_id
  JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE eq.status = 'approved'
    AND lf.curriculum_id = '33eb7832-8c80-46fa-a3ad-a9a5ee996e87'
    AND eq.cognitive_level = 'analyze'
    AND eq.difficulty = 'hard'
    AND NOT eq.question_text ~* '(fehler.*identifiz|fehler.*find|was.*falsch|welcher.*fehler|analysier|diagnostiz|ursache.*ermitteln|störung|defekt)'
  ORDER BY random()
  LIMIT 750
);

-- PHASE 6: Fix remaining easy excess - remember/easy → medium
UPDATE exam_questions
SET difficulty = 'medium'
WHERE id IN (
  SELECT eq.id
  FROM exam_questions eq
  JOIN competencies comp ON comp.id = eq.competency_id
  JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE eq.status = 'approved'
    AND lf.curriculum_id = '33eb7832-8c80-46fa-a3ad-a9a5ee996e87'
    AND eq.difficulty = 'easy'
  ORDER BY random()
  LIMIT 1100
)
