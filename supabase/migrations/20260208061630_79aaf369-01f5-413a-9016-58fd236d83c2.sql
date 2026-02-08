-- Allow anonymous users to view published courses
CREATE POLICY "Anyone can view published courses"
ON public.courses
FOR SELECT
TO anon
USING (status = 'published');

-- Also allow anonymous to view modules and lessons for published courses
CREATE POLICY "Anyone can view modules of published courses"
ON public.modules
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.courses 
    WHERE courses.id = modules.course_id 
    AND courses.status = 'published'
  )
);

CREATE POLICY "Anyone can view lessons of published courses"
ON public.lessons
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.modules m
    JOIN public.courses c ON c.id = m.course_id
    WHERE m.id = lessons.module_id 
    AND c.status = 'published'
  )
);