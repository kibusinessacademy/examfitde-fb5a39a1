
-- CLEANUP: Delete hollow completed exam_pool jobs older than 2 hours
-- These are the 8000+ waste jobs that generated 0 questions
-- Keep recent ones for forensic audit trail
DELETE FROM job_queue
WHERE job_type = 'package_generate_exam_pool'
AND status IN ('completed', 'cancelled')
AND created_at > now() - interval '48 hours'
AND created_at < now() - interval '2 hours'
AND COALESCE((result->>'generated')::int, 0) = 0
AND result->'metrics' IS NULL OR COALESCE((result->'metrics'->>'generated')::int, 0) = 0;
