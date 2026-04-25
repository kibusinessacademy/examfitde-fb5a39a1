-- ============================================================
-- SECURITY FIX 1: dsgvo_processing_records - admin-only SELECT
-- ============================================================
DROP POLICY IF EXISTS "Admins can read dsgvo" ON public.dsgvo_processing_records;

CREATE POLICY "Admins can read dsgvo"
ON public.dsgvo_processing_records
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- SECURITY FIX 2: user_badges - block anon inserts, enforce ownership
-- ============================================================
DROP POLICY IF EXISTS "System insert badges" ON public.user_badges;

CREATE POLICY "Users insert own badges"
ON public.user_badges
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role inserts badges"
ON public.user_badges
FOR INSERT
TO service_role
WITH CHECK (true);

-- ============================================================
-- SECURITY FIX 3: course_inquiries - admin-only SELECT
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view inquiries" ON public.course_inquiries;

CREATE POLICY "Admins can view inquiries"
ON public.course_inquiries
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- SECURITY FIX 4a: ai_tutor_audit - restrict inserts to service_role
-- ============================================================
DROP POLICY IF EXISTS "ai_tutor_audit_service_insert" ON public.ai_tutor_audit;

CREATE POLICY "ai_tutor_audit_service_insert"
ON public.ai_tutor_audit
FOR INSERT
TO service_role
WITH CHECK (true);

-- ============================================================
-- SECURITY FIX 4b: exam_ai_feedback - restrict inserts to owner/service
-- ============================================================
DROP POLICY IF EXISTS "Service inserts feedback" ON public.exam_ai_feedback;

-- service_role_insert_feedback policy already exists; add an owner-scoped
-- policy so authenticated users can submit their own feedback.
CREATE POLICY "Users insert own feedback"
ON public.exam_ai_feedback
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- SECURITY FIX 4c: outcome_tracking - restrict inserts to owner/service
-- ============================================================
DROP POLICY IF EXISTS "Service inserts outcomes" ON public.outcome_tracking;

CREATE POLICY "Users insert own outcomes"
ON public.outcome_tracking
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);
