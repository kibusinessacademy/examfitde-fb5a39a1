
ALTER TABLE public.course_packages DROP CONSTRAINT course_packages_status_check;
ALTER TABLE public.course_packages ADD CONSTRAINT course_packages_status_check 
  CHECK (status = ANY (ARRAY['planning', 'council_review', 'queued', 'building', 'qa', 'published', 'failed', 'blocked']));
