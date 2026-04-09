
-- Delete failed jobs that already have pending replacements
DELETE FROM job_queue 
WHERE status = 'failed' 
  AND updated_at > now() - interval '24 hours'
  AND job_type IN ('package_generate_lesson_minichecks', 'package_validate_tutor_index', 'package_generate_oral_exam', 'package_run_integrity_check')
  AND EXISTS (
    SELECT 1 FROM job_queue p 
    WHERE p.package_id = job_queue.package_id 
      AND p.job_type = job_queue.job_type 
      AND p.status IN ('pending', 'processing')
      AND p.id != job_queue.id
  );
