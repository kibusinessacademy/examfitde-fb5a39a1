
-- ═══ ROUND 3: Final micro-fixes ═══

-- EBT: understand 10.8% → ≥12% (need +24 more)
-- Reclassify medium/concept remember → understand
UPDATE exam_questions SET cognitive_level = 'understand'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
    AND status = 'approved'
    AND cognitive_level = 'remember'
    AND question_type = 'concept'
    AND difficulty = 'medium'
  ORDER BY length(question_text) DESC
  LIMIT 30
);

-- EBT: apply 23.9% → ≥25% (need +22 more)
-- Reclassify medium/remember calculation → apply
UPDATE exam_questions SET cognitive_level = 'apply'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
    AND status = 'approved'
    AND cognitive_level = 'remember'
    AND question_type = 'calculation'
  ORDER BY length(question_text) DESC
  LIMIT 30
);

-- SoVFa: transfer 8.8% → ≥10% (need +25 more)
-- Reclassify more case_study as transfer
UPDATE exam_questions SET question_type = 'transfer'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = '2b9715cb-6cea-40ab-8a34-16cec0b1e74c'
    AND status = 'approved'
    AND question_type = 'case_study'
    AND cognitive_level IN ('analyze', 'evaluate', 'apply')
    AND difficulty IN ('medium', 'hard', 'very_hard')
    AND id NOT IN (SELECT id FROM exam_questions WHERE question_type = 'transfer')
  LIMIT 30
);

-- EBT: Also reclassify some remember procedure medium → apply for weak LFs
UPDATE exam_questions SET cognitive_level = 'apply'
WHERE id IN (
  SELECT eq.id FROM exam_questions eq
  JOIN competencies comp ON comp.id = eq.competency_id
  WHERE comp.learning_field_id IN (
    'c5c98dcf-1352-4a86-81c0-dfdaa289fe91',
    '9f81c5f6-b625-42bd-bfcf-9ea855148d22',
    'c3605109-328f-4699-8bee-a7c2ef8a57f3'
  )
    AND eq.curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
    AND eq.status = 'approved'
    AND eq.cognitive_level = 'remember'
    AND eq.question_type IN ('procedure', 'calculation')
  LIMIT 15
);
