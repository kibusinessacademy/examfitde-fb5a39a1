-- Reset the zero-progress-guard block on package_generate_handbook
-- The block was triggered by repeated THRESHOLD_FAIL but v22 fix should resolve the root cause
UPDATE jobtype_limits SET max_processing = 2 WHERE job_type = 'package_generate_handbook';