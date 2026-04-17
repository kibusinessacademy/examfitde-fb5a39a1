-- Full meta reset for 3 looping jobs after content-runner deploy with fixed enrichment routing
UPDATE job_queue
SET
  status = 'pending',
  locked_at = NULL,
  locked_by = NULL,
  last_error = NULL,
  last_error_code = NULL,
  liveness_status = 'healthy',
  run_after = now(),
  attempts = 0,
  priority = LEAST(COALESCE(priority, 50), 5),
  meta = jsonb_build_object(
    'reset_by', 'enrichment_routing_fix_v2_post_deploy',
    'reset_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'is_repair', true
  )
WHERE id IN (
  '443e278c-fd12-4d26-9be9-956ae95b076f',
  'b6a67ca3-188c-4c02-9539-6dd275c71e52',
  '6c5c7568-0157-40b2-8e58-4d2b7b7c01bb'
);