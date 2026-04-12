
-- Fix Status-Drift: Promote lessons with real generated content from placeholder to active
UPDATE lessons
SET status = 'active'
WHERE status = 'placeholder'
  AND generation_status = 'generated'
  AND length(content::text) > 500
  AND content->>'_placeholder' IS NULL;

-- Reset integrity checks for affected packages
UPDATE package_steps
SET status = 'queued', started_at = NULL, finished_at = NULL, last_error = NULL
WHERE step_key = 'run_integrity_check'
  AND package_id IN ('de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb', '5377ab93-fe17-488c-a266-bdb26b672da7');
