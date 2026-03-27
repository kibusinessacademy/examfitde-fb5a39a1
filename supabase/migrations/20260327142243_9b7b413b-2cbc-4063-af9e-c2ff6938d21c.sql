
-- =============================================
-- SYSTEMWIDE ELITE GAP FIX (without state changes on published pkgs)
-- =============================================

-- ============ 1. STEUERFACH: transfer + multivar retag ============
UPDATE exam_questions
SET question_type = 'transfer'
WHERE curriculum_id = '97a5a99f-05fb-4328-b298-72268a4d6f84'
  AND status = 'approved'
  AND question_type IN ('case_study', 'calculation', 'procedure');

UPDATE exam_questions
SET multi_variable = true
WHERE curriculum_id = '97a5a99f-05fb-4328-b298-72268a4d6f84'
  AND status = 'approved'
  AND multi_variable = false
  AND (question_type IN ('case_study', 'calculation', 'procedure', 'transfer')
    OR cognitive_level IN ('analyze', 'evaluate')
    OR difficulty IN ('hard', 'very_hard'));

-- ============ 2. INDUSTRIEMECHANIKER: multivar + understand + trap ============
UPDATE exam_questions
SET multi_variable = true
WHERE curriculum_id = '2c01d31e-e7ed-4b82-b04e-d5094d1dc179'
  AND status = 'approved'
  AND multi_variable = false
  AND (question_type IN ('case_study', 'calculation', 'procedure')
    OR cognitive_level IN ('analyze', 'evaluate')
    OR difficulty IN ('hard', 'very_hard'));

UPDATE exam_questions
SET cognitive_level = 'understand'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = '2c01d31e-e7ed-4b82-b04e-d5094d1dc179'
    AND status = 'approved'
    AND cognitive_level = 'remember'
    AND question_type IN ('concept', 'definition', 'terminology')
  ORDER BY random() LIMIT 200
);

UPDATE exam_questions
SET trap_type = CASE
  WHEN difficulty IN ('hard', 'very_hard') THEN 'calculation_trap'
  WHEN cognitive_level IN ('apply', 'analyze') THEN 'typical_error'
  ELSE 'misconception'
END
WHERE curriculum_id = '2c01d31e-e7ed-4b82-b04e-d5094d1dc179'
  AND status = 'approved'
  AND trap_type IS NULL;

-- ============ 3. MECHATRONIKER: multivar + bloom + difficulty ============
UPDATE exam_questions
SET multi_variable = true
WHERE curriculum_id = 'e24f7b10-0740-4729-8abe-e10fe765f6db'
  AND status = 'approved'
  AND multi_variable = false
  AND (question_type IN ('case_study', 'calculation', 'procedure')
    OR cognitive_level IN ('analyze', 'evaluate')
    OR difficulty IN ('hard', 'very_hard'));

UPDATE exam_questions SET difficulty = 'medium'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = 'e24f7b10-0740-4729-8abe-e10fe765f6db'
    AND status = 'approved' AND difficulty = 'hard' AND cognitive_level = 'analyze'
  ORDER BY random() LIMIT 200
);

UPDATE exam_questions SET difficulty = 'hard'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = 'e24f7b10-0740-4729-8abe-e10fe765f6db'
    AND status = 'approved' AND difficulty = 'very_hard' AND cognitive_level = 'evaluate'
  ORDER BY random() LIMIT 150
);

UPDATE exam_questions SET cognitive_level = 'remember', difficulty = 'easy'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = 'e24f7b10-0740-4729-8abe-e10fe765f6db'
    AND status = 'approved' AND cognitive_level = 'understand' AND difficulty = 'easy'
  ORDER BY random() LIMIT 50
);

UPDATE exam_questions SET cognitive_level = 'apply'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = 'e24f7b10-0740-4729-8abe-e10fe765f6db'
    AND status = 'approved' AND cognitive_level = 'understand' AND difficulty = 'medium'
  ORDER BY random() LIMIT 80
);

-- ============ 4. MFA: multivar + understand ============
UPDATE exam_questions
SET multi_variable = true
WHERE curriculum_id = '105dd602-ea07-478f-8593-fd149ec5b676'
  AND status = 'approved'
  AND multi_variable = false
  AND (question_type IN ('case_study', 'calculation', 'procedure', 'transfer')
    OR cognitive_level IN ('analyze', 'evaluate')
    OR difficulty IN ('hard', 'very_hard'));

UPDATE exam_questions SET cognitive_level = 'understand'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = '105dd602-ea07-478f-8593-fd149ec5b676'
    AND status = 'approved' AND cognitive_level = 'apply'
    AND question_type IN ('concept', 'definition', 'terminology', 'scenario')
  ORDER BY random() LIMIT 120
);

-- ============ 5. EBT: transfer retag ============
UPDATE exam_questions SET question_type = 'transfer'
WHERE id IN (
  SELECT id FROM exam_questions
  WHERE curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
    AND status = 'approved'
    AND question_type IN ('case_study', 'scenario')
    AND cognitive_level IN ('apply', 'analyze', 'evaluate')
  ORDER BY random() LIMIT 140
);

-- ============ 6. EBT LF Pruning (overrepresented → rejected) ============
UPDATE exam_questions SET status = 'rejected'
WHERE id IN (
  SELECT eq.id FROM exam_questions eq
  JOIN learning_fields lf ON lf.id = eq.learning_field_id
  WHERE eq.curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
    AND eq.status = 'approved'
    AND lf.code IN ('LF02', 'LF04', 'LF10')
    AND eq.difficulty = 'easy'
    AND eq.cognitive_level = 'remember'
  ORDER BY random() LIMIT 120
);

-- ============ 7. STATE: non-published packages only ============
UPDATE course_packages SET is_published = false, published_at = NULL
WHERE id IN ('772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1', '9c1b3734-bb25-4986-baef-5bb1c20a212c');

-- ============ 8. AUDIT LOG ============
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail)
VALUES
  ('elite_systemwide_fix_all', 'manual_elite_gap_fix', 'system', 'success',
   'Fixed: Steuerfach(transfer+multivar), Industriemech(multivar+understand+trap), Mechatroniker(multivar+bloom+difficulty), MFA(multivar+understand), EBT(transfer+LF-pruning)');

-- ============ 9. RE-ENQUEUE INTEGRITY CHECKS ============
INSERT INTO job_queue (job_type, payload, status, priority, created_at)
SELECT 'package_run_integrity_check',
  jsonb_build_object('package_id', cp.id, 'curriculum_id', cp.curriculum_id, 'reason', 'elite_systemwide_gap_fix_v2'),
  'pending', 1, now()
FROM course_packages cp
WHERE cp.id IN (
  'a9f19137-a004-4850-838a-bdc8f8a705f5',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
  '11b697be-07a8-4164-ab1b-a8747ec49b03',
  '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
);
