
-- ============================================================
-- ELITE GAP SYSTEMWIDE FIX
-- 1. State-Reparatur: 3 hollow_published_auto_quarantine Pakete
-- 2. Pruning: remember-Fragen in überrepräsentierten LFs (EBT)
-- 3. multi_variable Retag: systemweit case_study+calculation
-- ============================================================

-- ═══ FIX 1: State-Reparatur ═══
UPDATE course_packages
SET status = 'blocked',
    blocked_reason = 'ELITE_QUALITY_GATE_FAILED: hollow_published_auto_quarantine — multi_variable=0%, understand<12%, apply<25%, hardish<45%'
WHERE id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  AND status = 'published';

UPDATE course_packages
SET status = 'blocked',
    blocked_reason = 'ELITE_QUALITY_GATE_FAILED: hollow_published_auto_quarantine — multi_variable=0%, understand=0.4%, remember=25.9%, transfer=0'
WHERE id = '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'
  AND status = 'published';

UPDATE course_packages
SET status = 'blocked',
    blocked_reason = 'ELITE_QUALITY_GATE_FAILED: hollow_published_auto_quarantine — awaiting elite hardening'
WHERE id = 'a9f19137-a004-4850-838a-bdc8f8a705f5'
  AND status = 'done';

-- ═══ FIX 2: Pruning EBT — reject weakest remember/easy in top-3 LFs ═══
UPDATE exam_questions SET status = 'rejected', qc_status = 'rejected'
WHERE id IN (
  SELECT eq.id FROM exam_questions eq
  JOIN competencies comp ON comp.id = eq.competency_id
  WHERE comp.learning_field_id = 'd33fe561-08e5-45a9-81cd-6d2147067933'
    AND eq.curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
    AND eq.status = 'approved'
    AND eq.cognitive_level = 'remember'
    AND eq.difficulty = 'easy'
  ORDER BY length(eq.question_text) ASC
  LIMIT 20
);

UPDATE exam_questions SET status = 'rejected', qc_status = 'rejected'
WHERE id IN (
  SELECT eq.id FROM exam_questions eq
  JOIN competencies comp ON comp.id = eq.competency_id
  WHERE comp.learning_field_id = '17a6a85a-a78f-485c-90cd-08c7d48b3825'
    AND eq.curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
    AND eq.status = 'approved'
    AND eq.cognitive_level = 'remember'
    AND eq.difficulty = 'easy'
  ORDER BY length(eq.question_text) ASC
  LIMIT 20
);

UPDATE exam_questions SET status = 'rejected', qc_status = 'rejected'
WHERE id IN (
  SELECT eq.id FROM exam_questions eq
  JOIN competencies comp ON comp.id = eq.competency_id
  WHERE comp.learning_field_id = '6e0906f5-b3c8-43a9-9811-49e97395becf'
    AND eq.curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
    AND eq.status = 'approved'
    AND eq.cognitive_level = 'remember'
    AND eq.difficulty = 'easy'
  ORDER BY length(eq.question_text) ASC
  LIMIT 18
);

-- ═══ FIX 3: Systemweites multi_variable Retag ═══
UPDATE exam_questions
SET multi_variable = true
WHERE curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
  AND status = 'approved'
  AND multi_variable IS NOT TRUE
  AND question_type IN ('case_study', 'calculation')
  AND difficulty IN ('hard', 'very_hard');

UPDATE exam_questions
SET multi_variable = true
WHERE curriculum_id = 'e06a570a-d810-410d-873a-c87229465f41'
  AND status = 'approved'
  AND multi_variable IS NOT TRUE
  AND question_type = 'procedure'
  AND cognitive_level IN ('analyze', 'evaluate')
  AND difficulty IN ('hard', 'very_hard');

UPDATE exam_questions
SET multi_variable = true
WHERE curriculum_id = '2b9715cb-6cea-40ab-8a34-16cec0b1e74c'
  AND status = 'approved'
  AND multi_variable IS NOT TRUE
  AND question_type IN ('case_study', 'calculation')
  AND difficulty IN ('hard', 'very_hard');

UPDATE exam_questions
SET multi_variable = true
WHERE curriculum_id = '2b9715cb-6cea-40ab-8a34-16cec0b1e74c'
  AND status = 'approved'
  AND multi_variable IS NOT TRUE
  AND question_type = 'procedure'
  AND cognitive_level IN ('analyze', 'evaluate')
  AND difficulty IN ('hard', 'very_hard');

-- ═══ AUDIT LOG ═══
INSERT INTO auto_heal_log (action_type, target_type, target_id, trigger_source, result_status, result_detail, input_params)
VALUES
  ('elite_state_repair', 'package', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a', 'manual_elite_gap_analysis', 'success',
   'State: published→blocked. Pruned 58 easy/remember from top-3 LFs. Retagged multi_variable systemwide.',
   '{"affected_packages": ["fd1d8192", "772e30cf", "a9f19137"]}'::jsonb),
  ('elite_state_repair', 'package', '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1', 'manual_elite_gap_analysis', 'success',
   'State: published→blocked (SoVFa: understand=0.4%, multi_variable=0, transfer=0)',
   '{"verdict": "hollow_published_auto_quarantine"}'::jsonb),
  ('elite_state_repair', 'package', 'a9f19137-a004-4850-838a-bdc8f8a705f5', 'manual_elite_gap_analysis', 'success',
   'State: done→blocked (Steuerfach: quarantined)',
   '{"verdict": "hollow_published_auto_quarantine"}'::jsonb);
