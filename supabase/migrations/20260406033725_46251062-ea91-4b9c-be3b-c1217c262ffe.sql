
-- P0 FIX: Unblock exam pool processing (was set to 0 = complete killswitch)
UPDATE jobtype_limits SET max_processing = 4 WHERE job_type = 'package_generate_exam_pool';

-- Also slightly increase oral_exam limit for better throughput
UPDATE jobtype_limits SET max_processing = 2 WHERE job_type = 'package_generate_oral_exam';
