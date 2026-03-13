-- Fix: validate_exam_pool deadlock — guard checked approved before validation could run.
-- Code fix deployed; now reset step + downstream to re-run.

-- 1) Reset validate_exam_pool to queued
UPDATE package_steps 
SET status = 'queued', 
    last_error = 'forensic-fix-v2: deadlock — guard checked approved before validation could run'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'::uuid
  AND step_key = 'validate_exam_pool'
  AND status = 'done';

-- 2) Reset downstream steps stuck in running 
UPDATE package_steps 
SET status = 'queued',
    last_error = 'forensic-fix-v2: reset due to upstream validate_exam_pool deadlock'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'::uuid
  AND step_key IN ('build_ai_tutor_index', 'elite_harden', 'validate_tutor_index', 
                   'generate_oral_exam', 'validate_oral_exam', 'run_integrity_check',
                   'quality_council', 'auto_publish')
  AND status IN ('running', 'queued', 'failed');

-- 3) Cancel zombie pending/processing jobs for this package
UPDATE job_queue 
SET status = 'cancelled', 
    last_error = 'forensic-fix-v2: deadlock resolution — validate_exam_pool chicken-egg guard'
WHERE payload->>'package_id' = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND status IN ('pending', 'processing')
  AND job_type IN ('package_validate_exam_pool', 'package_build_ai_tutor_index', 'package_elite_harden');