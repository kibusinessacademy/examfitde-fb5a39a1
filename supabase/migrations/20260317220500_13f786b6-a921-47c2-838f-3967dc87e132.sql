
-- Reset validate_exam_pool to 'queued' so pipeline re-validates the now-larger review pool
UPDATE package_steps 
SET status = 'queued'
WHERE package_id IN ('fd1d8192-a16f-496b-80c8-5e06f70ec21a', '2e8da39f-60f8-44d9-8b70-e1176222ca55')
  AND step_key = 'validate_exam_pool';

-- Also reset integrity_check and auto_publish to force re-evaluation after validation
UPDATE package_steps 
SET status = 'queued'
WHERE package_id IN ('fd1d8192-a16f-496b-80c8-5e06f70ec21a', '2e8da39f-60f8-44d9-8b70-e1176222ca55')
  AND step_key IN ('run_integrity_check', 'package_auto_publish');

-- Set packages back to building so pipeline picks them up
UPDATE course_packages 
SET status = 'building'
WHERE id IN ('fd1d8192-a16f-496b-80c8-5e06f70ec21a', '2e8da39f-60f8-44d9-8b70-e1176222ca55');
