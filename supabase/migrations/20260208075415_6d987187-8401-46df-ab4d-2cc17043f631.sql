-- ============================================================
-- Admin bypass: Admins can access ALL courses (including draft)
-- and related data regardless of enrollment
-- ============================================================

-- Admin can view all courses (including draft/archived)
CREATE POLICY "Admins can view all courses"
ON public.courses
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can view all modules
CREATE POLICY "Admins can view all modules"
ON public.modules
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can view all lessons
CREATE POLICY "Admins can view all lessons"
ON public.lessons
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can view all lesson outcomes (for monitoring learner progress)
CREATE POLICY "Admins can view all lesson outcomes"
ON public.lesson_outcomes
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can view all course enrollments
CREATE POLICY "Admins can view all enrollments"
ON public.course_enrollments
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can enroll in any course (bypass enrollment restrictions)
CREATE POLICY "Admins can enroll in any course"
ON public.course_enrollments
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can view all learning progress
CREATE POLICY "Admins can view all learning progress"
ON public.learning_progress
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));