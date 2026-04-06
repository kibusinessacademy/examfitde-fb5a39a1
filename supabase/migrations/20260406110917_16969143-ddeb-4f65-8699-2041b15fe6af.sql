
-- Heal Fachkraft Kurier (42bdd4d8): mark auto_seed_exam_blueprints done (77 blueprints exist, job completed)
UPDATE package_steps
SET status = 'done', updated_at = now()
WHERE package_id = '42bdd4d8-846c-46e3-9b3a-c4dfcc1ea081'
  AND step_key = 'auto_seed_exam_blueprints'
  AND status = 'queued';

-- Reset failed oral_exam job for retry
UPDATE job_queue
SET status = 'pending', attempts = 0, error = null, run_after = now()
WHERE id = 'f6a33977-fcc9-4754-b9e7-7ed514cc519d'
  AND job_type = 'package_generate_oral_exam'
  AND status = 'failed';
