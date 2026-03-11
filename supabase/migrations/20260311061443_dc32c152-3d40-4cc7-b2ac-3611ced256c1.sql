
-- Fix: Reset build_ai_tutor_index + downstream steps for Verkäufer package
-- Root cause: lf_coverage was calculated from handbook chapters (5) instead of actual LF content (10)
UPDATE package_steps 
SET status = 'queued', attempts = 0, last_error = NULL, finished_at = NULL, started_at = NULL
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key IN ('build_ai_tutor_index', 'validate_tutor_index', 'generate_oral_exam', 'validate_oral_exam', 'run_integrity_check', 'quality_council', 'auto_publish');
