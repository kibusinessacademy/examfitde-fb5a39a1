
-- Clear blocked_reason AND set building in one atomic update
-- The invariant trigger will allow it because blocked_reason becomes NULL
UPDATE course_packages 
SET status = 'building', 
    priority = 1, 
    blocked_reason = NULL, 
    updated_at = now()
WHERE id IN (
  'eef4bbe6-6c92-4969-941e-af471e86d67f',
  '03462382-f62e-4be9-9940-013d42a4435b',
  '961103c5-74be-4357-8573-c73862cb09b2'
);
