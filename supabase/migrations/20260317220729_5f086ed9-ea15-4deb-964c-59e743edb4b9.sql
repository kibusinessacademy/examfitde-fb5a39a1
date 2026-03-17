
-- Step 2: Move from quality_gate_failed → building (should be allowed)
UPDATE course_packages 
SET status = 'building', published_at = NULL
WHERE id IN ('fd1d8192-a16f-496b-80c8-5e06f70ec21a', '2e8da39f-60f8-44d9-8b70-e1176222ca55')
  AND status = 'quality_gate_failed';
