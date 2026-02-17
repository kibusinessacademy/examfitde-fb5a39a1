
-- Insert validate_learning_content step for all existing packages that don't have it yet
INSERT INTO public.package_steps (package_id, step_key, status, attempts, max_attempts, timeout_seconds)
SELECT 
  ps.package_id,
  'validate_learning_content',
  'queued'::step_status,
  0,
  100,
  300
FROM package_steps ps
WHERE ps.step_key = 'generate_learning_content'
AND NOT EXISTS (
  SELECT 1 FROM package_steps ps2 
  WHERE ps2.package_id = ps.package_id 
  AND ps2.step_key = 'validate_learning_content'
);
