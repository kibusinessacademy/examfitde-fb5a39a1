-- Insert generate_learning_content step for ALL existing packages that have scaffold_learning_course
INSERT INTO public.package_steps (package_id, step_key, status, max_attempts, timeout_seconds)
SELECT 
  ps.package_id,
  'generate_learning_content',
  'queued',
  100,
  900
FROM public.package_steps ps
WHERE ps.step_key = 'scaffold_learning_course'
AND NOT EXISTS (
  SELECT 1 FROM public.package_steps ps2 
  WHERE ps2.package_id = ps.package_id 
  AND ps2.step_key = 'generate_learning_content'
);

-- Create a database function to check placeholder guard
CREATE OR REPLACE FUNCTION public.check_no_placeholder_lessons(p_course_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  placeholder_count integer;
BEGIN
  SELECT count(*) INTO placeholder_count
  FROM lessons l
  JOIN modules m ON l.module_id = m.id
  WHERE m.course_id = p_course_id
  AND (
    l.content IS NULL 
    OR (l.content->>'_placeholder')::boolean = true
    OR length(l.content->>'html') < 100
  );
  
  RETURN placeholder_count = 0;
END;
$$;