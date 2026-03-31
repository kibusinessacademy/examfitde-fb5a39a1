
-- Temporarily increase max_parallel for oral exam generation from 1 to 3
UPDATE ai_worker_policies 
SET max_parallel = 3, updated_at = now()
WHERE job_type = 'package_generate_oral_exam';
