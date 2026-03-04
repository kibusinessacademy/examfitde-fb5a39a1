
ALTER TABLE public.course_packages DISABLE TRIGGER USER;

UPDATE public.course_packages
SET status = 'building', published_at = NULL, updated_at = now()
WHERE id = 'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb'
  AND status = 'published';

ALTER TABLE public.course_packages ENABLE TRIGGER USER;
