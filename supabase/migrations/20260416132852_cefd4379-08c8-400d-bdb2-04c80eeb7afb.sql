-- Reset zombie quality_council job for package 42bdd4d8
UPDATE public.job_queue 
SET status = 'cancelled', 
    last_error = 'ZOMBIE_RESET: council gate failed (score=67, council_approved=false). Fail-path logic fixed — markStepFailed now used on fail.',
    completed_at = now(),
    updated_at = now()
WHERE id = '8f407659-1be5-4ce1-a983-d77cc21e6499'
  AND status = 'processing';

-- Also reset the step back to queued cleanly (clear any stale started_at)
UPDATE public.package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"zombie_reset": true, "reset_reason": "fail-path fix deployed"}'::jsonb
WHERE package_id = '42bdd4d8-846c-46e3-9b3a-c4dfcc1ea081'
  AND step_key = 'quality_council';