
UPDATE public.course_packages
SET blocked_reason = NULL, status = 'building', updated_at = now()
WHERE id = 'f2039067-e58a-4e94-9573-b5953d435873';
