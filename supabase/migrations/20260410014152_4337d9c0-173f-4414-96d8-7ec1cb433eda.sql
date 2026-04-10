
-- Heal STUDIUM oral_exam steps: STUDIUM has hasOralExam=false, so these must be skipped
UPDATE package_steps 
SET status = 'skipped'
WHERE package_id = 'c5000000-0004-4000-8000-000000000001'
  AND step_key IN ('generate_oral_exam', 'validate_oral_exam')
  AND status != 'skipped';

-- Heal failed EXAM_FIRST_PLUS validate_handbook job
UPDATE job_queue 
SET status = 'pending', last_error = NULL, attempts = 0, started_at = NULL
WHERE package_id = 'fa931e34-52ee-4296-889f-303575b088d5'
  AND job_type = 'package_validate_handbook'
  AND status = 'failed';

-- Cancel any orphaned oral_exam jobs for STUDIUM packages
UPDATE job_queue 
SET status = 'cancelled', last_error = 'track_heal: STUDIUM has no oral exam'
WHERE package_id IN (
  SELECT cp.id FROM course_packages cp WHERE cp.track = 'STUDIUM'
)
AND job_type IN ('package_generate_oral_exam', 'package_validate_oral_exam')
AND status IN ('pending', 'queued', 'processing');
