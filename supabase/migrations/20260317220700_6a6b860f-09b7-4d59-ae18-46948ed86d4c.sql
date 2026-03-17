
-- Use allowed transition: published → quality_gate_failed → building
-- Step 1: Move to quality_gate_failed (allowed by trigger)
UPDATE course_packages 
SET status = 'quality_gate_failed'
WHERE id IN ('fd1d8192-a16f-496b-80c8-5e06f70ec21a', '2e8da39f-60f8-44d9-8b70-e1176222ca55')
  AND status = 'published';
