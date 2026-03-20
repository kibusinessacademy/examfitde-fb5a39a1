
UPDATE exam_questions
SET status = 'rejected',
    qc_status = 'pruned_overflow'
WHERE curriculum_id = '2c01d31e-e7ed-4b82-b04e-d5094d1dc179'
  AND status = 'draft'
  AND qc_status = 'pending';
