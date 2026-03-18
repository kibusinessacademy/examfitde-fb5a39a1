-- Cancel the 3 broken jobs with unprefixed job_types (already failed, just mark cancelled for clarity)
UPDATE public.job_queue
SET status = 'cancelled',
    error = 'FIXED: unprefixed job_type → use package_ prefix. Original: ' || error
WHERE status = 'failed'
  AND job_type IN ('validate_exam_pool', 'run_integrity_check', 'quality_council')
  AND error LIKE 'UNKNOWN_JOB_TYPE%';