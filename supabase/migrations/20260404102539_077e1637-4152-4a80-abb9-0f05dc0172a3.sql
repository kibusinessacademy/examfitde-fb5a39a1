
UPDATE public.course_packages 
SET status = 'queued', priority = 5, updated_at = now()
WHERE id = 'c5000000-0004-4000-8000-000000000001' 
  AND status = 'planning';
