
-- Re-enqueue failed generate_curriculum_content for Gesundheitsmanagement
UPDATE public.job_queue
SET status = 'pending', attempts = 0, last_error = NULL,
    meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{revived_reason}', '"studium_routing_fix"')
WHERE id = '7ff02072-28dc-456b-9e9e-8eb0a9fe2a03';

-- Re-enqueue failed setup_course_package (will succeed once curriculum_content is done)
UPDATE public.job_queue
SET status = 'pending', attempts = 0, last_error = NULL,
    meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{revived_reason}', '"studium_routing_fix"'),
    run_after = now() + interval '3 minutes'
WHERE id = '8d202871-93a7-4d2d-ac6d-9eb3470813c0';
