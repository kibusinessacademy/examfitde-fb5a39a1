
-- Wave-1 Recovery: Set default-priority packages from 100 to 5
UPDATE public.course_packages
SET priority = 5, updated_at = now()
WHERE status = 'queued' AND priority = 100;
