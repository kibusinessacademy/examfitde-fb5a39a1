
-- MFA: Promote 2864 draft+tier1_passed exam questions to review
UPDATE exam_questions
SET status = 'review'
WHERE curriculum_id = '105dd602-ea07-478f-8593-fd149ec5b676'
  AND status = 'draft'
  AND qc_status = 'tier1_passed';

-- MFA: Reset tier1_failed lessons to pending for re-generation
UPDATE lessons
SET qc_status = 'pending'
WHERE module_id IN (
  SELECT m.id FROM modules m WHERE m.course_id = '884623f6-ac26-434e-8f0e-154015967723'
)
AND qc_status = 'tier1_failed';

-- Mechatroniker: Promote 1224 draft+qc_pending exam questions to review
UPDATE exam_questions
SET status = 'review'
WHERE curriculum_id = 'e24f7b10-0740-4729-8abe-e10fe765f6db'
  AND status = 'draft'
  AND qc_status = 'pending';

-- Mechatroniker: Reset tier1_failed lessons to pending
UPDATE lessons
SET qc_status = 'pending'
WHERE module_id IN (
  SELECT m.id FROM modules m WHERE m.course_id = '6e0a20c0-918a-416b-a448-89f94908caa6'
)
AND qc_status = 'tier1_failed';
