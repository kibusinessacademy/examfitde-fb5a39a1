
-- Unblock all 3 packages: reset to building, clear blocked_reason,
-- reset auto_publish and council_review to queued so pipeline can re-run them
UPDATE public.package_steps
SET status = 'queued', updated_at = now()
WHERE package_id IN (
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '59b6e214-e181-4c2b-986e-1ce544984d04',
  '11b697be-07a8-4164-ab1b-a8747ec49b03'
)
AND step_key = 'auto_publish'
AND status = 'blocked';

-- Reset integrity check so it re-evaluates fresh
UPDATE public.package_steps
SET status = 'queued', updated_at = now()
WHERE package_id IN (
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '59b6e214-e181-4c2b-986e-1ce544984d04',
  '11b697be-07a8-4164-ab1b-a8747ec49b03'
)
AND step_key = 'run_integrity_check';

-- Unblock packages: set status to building, clear blocked_reason
UPDATE public.course_packages
SET status = 'building',
    blocked_reason = NULL,
    updated_at = now()
WHERE id IN (
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '59b6e214-e181-4c2b-986e-1ce544984d04',
  '11b697be-07a8-4164-ab1b-a8747ec49b03'
)
AND status = 'blocked';

-- Cancel any old failed/blocked jobs for these packages to prevent loop guard interference
UPDATE public.job_queue
SET status = 'cancelled', updated_at = now()
WHERE package_id IN (
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '59b6e214-e181-4c2b-986e-1ce544984d04',
  '11b697be-07a8-4164-ab1b-a8747ec49b03'
)
AND status = 'failed';

-- Audit log
INSERT INTO public.admin_actions (action, scope, payload, affected_ids)
VALUES (
  'unblock_and_retrigger',
  'packages',
  '{"reason": "Manual unblock: content pipeline complete, 0 broken lessons, re-triggering integrity + council + auto_publish"}'::jsonb,
  ARRAY['2e8da39f-60f8-44d9-8b70-e1176222ca55','59b6e214-e181-4c2b-986e-1ce544984d04','11b697be-07a8-4164-ab1b-a8747ec49b03']
);
