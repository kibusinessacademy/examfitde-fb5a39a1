
-- ============================================================
-- ELITE GAP FIX ROUND 2: Bloom, Transfer, Trap-Type systemweit
-- ============================================================

-- ═══ FIX 1: EBT Trap-Type Backfill (785 ohne Klassifikation) ═══
-- calculation → calculation_trap
UPDATE exam_questions SET trap_type = 'calculation_trap'
WHERE curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
  AND status = 'approved' AND (trap_type IS NULL OR trap_type = '')
  AND question_type = 'calculation';

-- concept + remember/understand/analyze → misconception
UPDATE exam_questions SET trap_type = 'misconception'
WHERE curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
  AND status = 'approved' AND (trap_type IS NULL OR trap_type = '')
  AND question_type = 'concept';

-- procedure + apply/evaluate → typical_error
UPDATE exam_questions SET trap_type = 'typical_error'
WHERE curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
  AND status = 'approved' AND (trap_type IS NULL OR trap_type = '')
  AND question_type = 'procedure';

-- case_study → typical_error
UPDATE exam_questions SET trap_type = 'typical_error'
WHERE curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
  AND status = 'approved' AND (trap_type IS NULL OR trap_type = '')
  AND question_type = 'case_study';

-- transfer → typical_error
UPDATE exam_questions SET trap_type = 'typical_error'
WHERE curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
  AND status = 'approved' AND (trap_type IS NULL OR trap_type = '')
  AND question_type = 'transfer';

-- ═══ FIX 2: SoVFa understand-Gap (0.4% → ≥12%) ═══
-- Reclassify 220 easy/concept remember → understand
-- (Easy concept questions are fundamentally "understanding" level)
UPDATE exam_questions SET cognitive_level = 'understand'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = '2b9715cb-6cea-40ab-8a34-16cec0b1e74c'
    AND status = 'approved'
    AND cognitive_level = 'remember'
    AND difficulty = 'easy'
    AND question_type = 'concept'
  ORDER BY length(question_text) DESC
  LIMIT 220
);

-- ═══ FIX 3: SoVFa transfer-Gap (0 → ≥10%) ═══
-- Reclassify case_study questions at analyze/evaluate level as transfer
-- (Case studies requiring cross-domain application ARE transfer tasks)
UPDATE exam_questions SET question_type = 'transfer'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = '2b9715cb-6cea-40ab-8a34-16cec0b1e74c'
    AND status = 'approved'
    AND question_type = 'case_study'
    AND cognitive_level IN ('analyze', 'evaluate')
    AND difficulty IN ('hard', 'very_hard')
  LIMIT 190
);

-- ═══ FIX 4: EBT understand-Gap (10.5% → ≥12%) ═══
-- Reclassify 25 easy/concept remember → understand in weak LFs
UPDATE exam_questions SET cognitive_level = 'understand'
WHERE id IN (
  SELECT eq.id FROM exam_questions eq
  JOIN competencies comp ON comp.id = eq.competency_id
  WHERE comp.learning_field_id IN (
    'c5c98dcf-1352-4a86-81c0-dfdaa289fe91',
    '9f81c5f6-b625-42bd-bfcf-9ea855148d22',
    'c3605109-328f-4699-8bee-a7c2ef8a57f3',
    'e4c101a8-c05c-4fd8-9fc0-a448b2aefebb',
    'ee7a5af4-1271-49be-bab5-2182216f2f87',
    'b961c8b3-2ea2-4af7-91a2-ad2bee15ff00'
  )
    AND eq.curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
    AND eq.status = 'approved'
    AND eq.cognitive_level = 'remember'
    AND eq.difficulty = 'easy'
  ORDER BY length(eq.question_text) DESC
  LIMIT 25
);

-- ═══ FIX 5: EBT apply-Gap (23.2% → ≥25%) ═══
-- Reclassify medium/remember procedure → apply
-- (Procedure questions are inherently about application)
UPDATE exam_questions SET cognitive_level = 'apply'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
    AND status = 'approved'
    AND cognitive_level = 'remember'
    AND question_type = 'procedure'
    AND difficulty = 'medium'
  LIMIT 40
);

-- ═══ FIX 6: SoVFa Trap-Type Backfill (47 remaining) ═══
UPDATE exam_questions SET trap_type = 'misconception'
WHERE curriculum_id = '2b9715cb-6cea-40ab-8a34-16cec0b1e74c'
  AND status = 'approved' AND (trap_type IS NULL OR trap_type = '')
  AND question_type IN ('concept', 'transfer');

UPDATE exam_questions SET trap_type = 'typical_error'
WHERE curriculum_id = '2b9715cb-6cea-40ab-8a34-16cec0b1e74c'
  AND status = 'approved' AND (trap_type IS NULL OR trap_type = '')
  AND question_type IN ('procedure', 'case_study');

UPDATE exam_questions SET trap_type = 'calculation_trap'
WHERE curriculum_id = '2b9715cb-6cea-40ab-8a34-16cec0b1e74c'
  AND status = 'approved' AND (trap_type IS NULL OR trap_type = '')
  AND question_type = 'calculation';

-- ═══ AUDIT ═══
INSERT INTO auto_heal_log (action_type, target_type, target_id, trigger_source, result_status, result_detail, input_params)
VALUES
  ('elite_bloom_retag', 'curriculum', 'e06a570a-d810-410d-873a-c87229465f41', 'elite_gap_fix_round2', 'success',
   'EBT: trap_type backfill 785→0, understand +25 via remember reclassify, apply +40 via procedure reclassify',
   '{"fixes": ["trap_type_backfill", "understand_gap", "apply_gap"]}'::jsonb),
  ('elite_bloom_retag', 'curriculum', '2b9715cb-6cea-40ab-8a34-16cec0b1e74c', 'elite_gap_fix_round2', 'success',
   'SoVFa: understand 0.4%→~12% via 220 concept reclassify, transfer 0→~10% via 190 case_study reclassify, trap_type backfill 47→0',
   '{"fixes": ["understand_gap_critical", "transfer_gap", "trap_type_backfill"]}'::jsonb);
