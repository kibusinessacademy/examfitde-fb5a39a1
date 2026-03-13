
-- Forensic Fix v3: Force redeploy took effect. Reset validate_exam_pool + downstream.
-- The old cached edge function was still checking for 'approved' questions (chicken-egg deadlock).
-- New deployed version checks for ANY questions (incl. draft).

-- 1) Reset validate_exam_pool from done → queued (it ran with OLD code)
UPDATE package_steps 
SET status = 'queued', 
    last_error = 'forensic-fix-v3: edge function was cached (old code). Redeployed + reset.'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'::uuid
  AND step_key = 'validate_exam_pool'
  AND status = 'done';

-- 2) Reset downstream steps that are running/queued with stale state
UPDATE package_steps 
SET status = 'queued',
    last_error = 'forensic-fix-v3: cascade reset after validate_exam_pool redeploy'
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'::uuid
  AND step_key IN ('build_ai_tutor_index', 'elite_harden', 'validate_tutor_index', 
                   'generate_oral_exam', 'validate_oral_exam', 'run_integrity_check',
                   'quality_council', 'auto_publish')
  AND status IN ('running', 'queued', 'failed');

-- 3) Cancel any active/pending jobs for this package that are stuck on old artifacts
UPDATE job_queue 
SET status = 'cancelled', 
    last_error = 'forensic-fix-v3: cancelled after edge function redeploy'
WHERE payload->>'package_id' = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND status IN ('pending', 'processing')
  AND job_type IN ('package_validate_exam_pool', 'package_build_ai_tutor_index', 'package_elite_harden');
