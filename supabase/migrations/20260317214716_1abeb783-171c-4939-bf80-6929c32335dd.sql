UPDATE jobtype_limits SET max_processing = 20 WHERE job_type = 'lesson_generate_content';
UPDATE jobtype_limits SET max_processing = 12 WHERE job_type = 'lesson_generate_content_shard';